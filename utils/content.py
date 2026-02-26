"""
Content management utilities for file-based CMS.
Handles loading and saving markdown files with YAML frontmatter.
"""
import base64
import hashlib
import json
import logging
import os
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import lru_cache
from html import escape
from pathlib import Path
from threading import RLock
from time import monotonic
from typing import Optional

import markdown
import yaml
from bs4 import BeautifulSoup
from markdown.extensions.fenced_code import FencedCodeExtension
from markdown.extensions.tables import TableExtension

logger = logging.getLogger(__name__)

__all__ = [
    "CONTENT_DIR",
    "PROJECTS_DIR",
    "ABOUT_FILE",
    "SETTINGS_FILE",
    "GeneralInfo",
    "ProjectInfo",
    "validate_slug",
    "content_revision",
    "load_project",
    "load_all_projects",
    "save_project",
    "delete_project",
    "load_settings",
    "save_settings",
    "load_about",
    "save_about",
    "format_date",
]

SLUG_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]*$')


# Register YAML representers once at module level
def _date_representer(dumper, data):
    return dumper.represent_scalar("tag:yaml.org,2002:str", data.isoformat())


yaml.add_representer(date, _date_representer)
yaml.add_representer(datetime, _date_representer)

# Base paths
CONTENT_DIR = Path(__file__).parent.parent / "content"
PROJECTS_DIR = CONTENT_DIR / "projects"
SETTINGS_FILE = CONTENT_DIR / "settings.json"
ABOUT_FILE = CONTENT_DIR / "about.md"


@dataclass
class _ParsedProjectCacheEntry:
    mtime_ns: int
    size: int
    cached_at: float
    frontmatter: dict
    markdown_content: str
    revision: str


@dataclass
class _RenderedProjectCacheEntry:
    mtime_ns: int
    size: int
    cached_at: float
    html_content: str


@dataclass
class _AboutCacheEntry:
    mtime_ns: int
    size: int
    cached_at: float
    html_content: str
    markdown_content: str
    revision: str


PROJECT_CACHE_MAX_ENTRIES = max(1, int(os.getenv("PROJECT_CACHE_MAX_ENTRIES", "256")))
PROJECT_CACHE_TTL_SECONDS = max(1, int(os.getenv("PROJECT_CACHE_TTL_SECONDS", "1800")))

_cache_lock = RLock()
_project_parse_cache: "OrderedDict[str, _ParsedProjectCacheEntry]" = OrderedDict()
_project_html_cache: "OrderedDict[str, _RenderedProjectCacheEntry]" = OrderedDict()
_about_cache: Optional[_AboutCacheEntry] = None


def _revision_from_content(content: str) -> str:
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _is_fresh(cached_at: float, now: float) -> bool:
    return (now - cached_at) <= PROJECT_CACHE_TTL_SECONDS


def _prune_project_cache_locked(
    cache: "OrderedDict[str, _ParsedProjectCacheEntry | _RenderedProjectCacheEntry]",
    now: float,
) -> None:
    stale_keys = [key for key, entry in cache.items() if not _is_fresh(entry.cached_at, now)]
    for key in stale_keys:
        cache.pop(key, None)

    while len(cache) > PROJECT_CACHE_MAX_ENTRIES:
        cache.popitem(last=False)


def _project_stat(filepath: Path) -> tuple[int, int]:
    stat = filepath.stat()
    return stat.st_mtime_ns, stat.st_size


def _invalidate_project_cache(slug: str) -> None:
    with _cache_lock:
        _project_parse_cache.pop(slug, None)
        _project_html_cache.pop(slug, None)


def _invalidate_about_cache() -> None:
    global _about_cache
    with _cache_lock:
        _about_cache = None


def _get_cached_project_parse(slug: str, filepath: Path) -> _ParsedProjectCacheEntry:
    mtime_ns, size = _project_stat(filepath)
    now = monotonic()
    with _cache_lock:
        cached = _project_parse_cache.get(slug)
        if cached and cached.mtime_ns == mtime_ns and cached.size == size and _is_fresh(cached.cached_at, now):
            _project_parse_cache.move_to_end(slug)
            return cached
        if cached:
            _project_parse_cache.pop(slug, None)

    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    frontmatter, markdown_content = parse_frontmatter(content)
    parsed = _ParsedProjectCacheEntry(
        mtime_ns=mtime_ns,
        size=size,
        cached_at=now,
        frontmatter=frontmatter,
        markdown_content=markdown_content,
        revision=_revision_from_content(content),
    )

    with _cache_lock:
        _project_parse_cache[slug] = parsed
        _project_parse_cache.move_to_end(slug)
        _prune_project_cache_locked(_project_parse_cache, now)
        cached_html = _project_html_cache.get(slug)
        if cached_html and (cached_html.mtime_ns != mtime_ns or cached_html.size != size):
            _project_html_cache.pop(slug, None)
        _prune_project_cache_locked(_project_html_cache, now)
    return parsed


@lru_cache(maxsize=512)
def _parse_iso_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return date.min


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """
    Parse YAML frontmatter from markdown content.
    Returns (frontmatter_dict, markdown_content).
    """
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', content, re.DOTALL)
    if match:
        try:
            frontmatter = yaml.safe_load(match.group(1)) or {}
        except yaml.YAMLError:
            frontmatter = {}
        markdown_content = match.group(2)
    else:
        frontmatter = {}
        markdown_content = content
    return frontmatter, markdown_content


def serialize_frontmatter(frontmatter: dict, markdown_content: str) -> str:
    """Serialize frontmatter dict and markdown content back to a file string."""
    frontmatter_str = yaml.dump(
        frontmatter, default_flow_style=False, allow_unicode=True, sort_keys=False
    )
    return f"---\n{frontmatter_str}---\n\n{markdown_content}"


def process_html_blocks(content: str) -> str:
    """
    Replace <!-- html -->...<!-- /html --> with base64-encoded placeholders.
    Uses line-anchored markers with non-greedy capture.
    """
    # Pattern: markers can have flexible whitespace and optional style attribute.
    pattern = r'<!--\s*html(?:\s+style="([^"]*)")?\s*-->\s*\n?(.*?)\n?\s*<!--\s*/html\s*-->'

    def replace(m):
        style = (m.group(1) or '').replace('&quot;', '"').strip()
        html = m.group(2)
        # Base64 encode to avoid attribute escaping issues
        encoded = base64.b64encode(html.encode('utf-8')).decode('ascii')
        style_attr = f' style="{escape(style, quote=True)}"' if style else ''
        return f'<div class="html-block-sandbox" data-html-b64="{encoded}"{style_attr}></div>'

    return re.sub(pattern, replace, content, flags=re.DOTALL)


def strip_layout_markers(md_content: str) -> str:
    """Remove row/column layout comments from markdown prior to rendering."""
    return re.sub(r'<!--\s*/?(row|col)\s*-->', '', md_content)


def split_blocks(md_content: str) -> list[str]:
    """Split markdown into top-level blocks using editor block separators."""
    pattern = re.compile(r'\n+\s*<!--\s*block\s*-->\s*\n+')
    parts = pattern.split(md_content)
    return [part for part in parts if part.strip()]


def parse_row_block(md_block: str) -> Optional[tuple[str, str]]:
    """
    Parse a row block:
      <!-- row -->
      left...
      <!-- col -->
      right...
      <!-- /row -->
    Returns (left_markdown, right_markdown) when valid.
    """
    stripped = md_block.strip()
    if not stripped:
        return None

    if not re.match(r'^\s*<!--\s*row\s*-->\s*', stripped):
        return None
    if not re.search(r'<!--\s*/row\s*-->\s*$', stripped):
        return None

    inner = re.sub(r'^\s*<!--\s*row\s*-->\s*', '', stripped, count=1)
    inner = re.sub(r'\s*<!--\s*/row\s*-->\s*$', '', inner, count=1)
    columns = re.split(r'\n*\s*<!--\s*col\s*-->\s*\n*', inner, maxsplit=1)
    if len(columns) != 2:
        return None

    left_md = (columns[0] or '').strip()
    right_md = (columns[1] or '').strip()
    return left_md, right_md


def _build_markdown_renderer() -> markdown.Markdown:
    return markdown.Markdown(extensions=[
        FencedCodeExtension(),
        TableExtension(),
        "nl2br",
        "sane_lists",  # Better list handling - prevents tight coupling with adjacent content
        "smarty",  # Smart quotes and dashes
        "toc",  # Generates IDs for headings (enables anchor links)
    ])


def _convert_markdown(
    md_content: str,
    renderer: Optional[markdown.Markdown] = None,
) -> str:
    """Convert markdown string to HTML with project-standard extensions."""
    md = renderer or _build_markdown_renderer()
    if renderer is not None:
        md.reset()
    return md.convert(md_content)


def render_markdown_block(
    md_content: str,
    renderer: Optional[markdown.Markdown] = None,
) -> str:
    """Render a markdown block using the project markdown pipeline."""
    md = process_html_blocks(md_content)
    md = strip_layout_markers(md)
    html = _convert_markdown(md, renderer=renderer)
    html = convert_alignment_comments(html).strip()
    return optimize_media_loading(html).strip()


def convert_alignment_comments(html_content: str) -> str:
    """Convert editor alignment comment markers to HTML wrappers."""
    html_content = re.sub(
        r'<!-- align:(center|right) -->',
        r'<div style="text-align: \1">',
        html_content,
    )
    return re.sub(r'<!-- /align -->', '</div>', html_content)


def optimize_media_loading(html_content: str) -> str:
    """Apply lazy-loading defaults to project-body media markup."""
    if "<img" not in html_content and "<iframe" not in html_content and "<video" not in html_content:
        return html_content

    soup = BeautifulSoup(html_content, "html.parser")

    for image in soup.find_all("img"):
        image.attrs.setdefault("loading", "lazy")
        image.attrs.setdefault("decoding", "async")

    for iframe in soup.find_all("iframe"):
        iframe.attrs.setdefault("loading", "lazy")

    # Defer inline project-content videos until they approach viewport.
    for video in soup.find_all("video"):
        classes = list(video.get("class", []))
        if "lazy-video" not in classes:
            classes.append("lazy-inline-video")
        video["class"] = classes
        video["preload"] = "none"

        src = video.get("src")
        if src:
            video["data-src"] = src
            del video["src"]

        for source in video.find_all("source"):
            source_src = source.get("src")
            if source_src:
                source["data-src"] = source_src
                del source["src"]

    return str(soup)


def markdown_to_html(md_content: str) -> str:
    """
    Convert markdown content to HTML.
    Handles block separators and preserves HTML tags.
    """
    blocks = split_blocks(md_content)
    if not blocks:
        blocks = [md_content]

    rendered_blocks: list[str] = []
    renderer = _build_markdown_renderer()
    for block in blocks:
        row_columns = parse_row_block(block)
        if row_columns:
            left_md, right_md = row_columns
            left_html = render_markdown_block(left_md, renderer=renderer)
            right_html = render_markdown_block(right_md, renderer=renderer)
            rendered_blocks.append(
                '<div class="content-block content-block-row">'
                '<div class="content-row">'
                f'<div class="content-col content-col-left">{left_html}</div>'
                f'<div class="content-col content-col-right">{right_html}</div>'
                '</div>'
                '</div>'
            )
            continue

        html = render_markdown_block(block, renderer=renderer)
        if html:
            rendered_blocks.append(f'<div class="content-block">{html}</div>')

    return '\n'.join(rendered_blocks)


def validate_slug(slug: str) -> bool:
    """Validate that a slug contains only safe characters (lowercase alphanumeric, hyphens, underscores)."""
    return bool(SLUG_PATTERN.match(slug))


def content_revision(filepath: Path) -> Optional[str]:
    """Compute a short SHA-256 revision hash of a file's contents.

    Used for optimistic conflict detection — the client sends back the
    revision it loaded, and the server rejects the save if the file
    changed since then.
    """
    if not filepath.exists():
        return None
    data = filepath.read_bytes()
    return "sha256:" + hashlib.sha256(data).hexdigest()[:16]


def load_project(
    slug: str,
    include_html: bool = True,
    include_revision: bool = True,
) -> Optional[dict]:
    """
    Load a project by slug.
    Returns dict with frontmatter fields and 'html_content'.
    """
    if not validate_slug(slug):
        return None
    filepath = PROJECTS_DIR / f"{slug}.md"
    if not filepath.exists():
        _invalidate_project_cache(slug)
        return None

    parsed = _get_cached_project_parse(slug, filepath)
    frontmatter = parsed.frontmatter
    markdown_content = parsed.markdown_content
    html_content = ""
    if include_html:
        now = monotonic()
        with _cache_lock:
            html_cached = _project_html_cache.get(slug)
            if html_cached and html_cached.mtime_ns == parsed.mtime_ns and html_cached.size == parsed.size and _is_fresh(html_cached.cached_at, now):
                html_content = html_cached.html_content
                _project_html_cache.move_to_end(slug)
            elif html_cached:
                _project_html_cache.pop(slug, None)
        if not html_content:
            html_content = markdown_to_html(markdown_content)
            with _cache_lock:
                _project_html_cache[slug] = _RenderedProjectCacheEntry(
                    mtime_ns=parsed.mtime_ns,
                    size=parsed.size,
                    cached_at=now,
                    html_content=html_content,
                )
                _project_html_cache.move_to_end(slug)
                _prune_project_cache_locked(_project_html_cache, now)

    # Build project dict
    project = {
        'slug': slug,
        'name': frontmatter.get('name', slug),
        'creation_date': frontmatter.get('date'),
        'is_draft': frontmatter.get('draft', False),
        'pinned': frontmatter.get('pinned', False),
        'youtube_link': frontmatter.get('youtube'),
        'html_content': html_content,
        'markdown_content': markdown_content,
        'revision': parsed.revision if include_revision else None,
    }

    # Video fields
    video = frontmatter.get('video', {})
    if video:
        project['video_link'] = video.get('hls')
        project['thumbnail_link'] = video.get('thumbnail')
        project['sprite_sheet_link'] = video.get('spriteSheet')
        project['frames'] = video.get('frames')
        project['columns'] = video.get('columns')
        project['rows'] = video.get('rows')
        project['frame_width'] = video.get('frame_width')
        project['frame_height'] = video.get('frame_height')
        project['fps'] = video.get('fps')
        project['video_width'] = video.get('video_width')
        project['video_height'] = video.get('video_height')
    else:
        project['video_link'] = None
        project['thumbnail_link'] = None
        project['sprite_sheet_link'] = None
        project['frames'] = None
        project['columns'] = None
        project['rows'] = None
        project['frame_width'] = None
        project['frame_height'] = None
        project['fps'] = None
        project['video_width'] = None
        project['video_height'] = None

    return project


def load_all_projects(
    include_drafts: bool = False,
    include_html: bool = True,
    include_revision: bool = True,
) -> list[dict]:
    """
    Load all projects from the content directory.
    Returns list of project dicts sorted by date (newest first), with pinned at top.
    """
    projects = []

    if not PROJECTS_DIR.exists():
        return projects

    for filepath in PROJECTS_DIR.glob("*.md"):
        slug = filepath.stem
        project = load_project(
            slug,
            include_html=include_html,
            include_revision=include_revision,
        )
        if project:
            if include_drafts or not project.get('is_draft', False):
                projects.append(project)

    # Sort: pinned first, then by date descending
    def sort_key(p):
        pinned = 1 if p.get('pinned') else 0
        # Handle date sorting
        d = p.get('creation_date')
        if isinstance(d, str):
            d = _parse_iso_date(d)
        elif d is None:
            d = date.min
        return (-pinned, -d.toordinal() if d else 0)

    projects.sort(key=sort_key)
    return projects


def save_project(slug: str, frontmatter: dict, markdown_content: str) -> bool:
    """
    Save a project to a markdown file and sync to S3.
    """
    if not validate_slug(slug):
        raise ValueError(f"Invalid slug: {slug}")
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    filepath = PROJECTS_DIR / f"{slug}.md"

    content = serialize_frontmatter(frontmatter, markdown_content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    _invalidate_project_cache(slug)
    _sync_to_s3(filepath)
    return True


def delete_project(slug: str) -> bool:
    """
    Delete a project file.  Archives to S3 first as a safety net,
    then removes from both local filesystem and S3.
    """
    if not validate_slug(slug):
        raise ValueError(f"Invalid slug: {slug}")
    filepath = PROJECTS_DIR / f"{slug}.md"
    if filepath.exists():
        _archive_to_s3(filepath)
        filepath.unlink()
        _invalidate_project_cache(slug)
        _delete_from_s3(filepath)
        return True
    return False


def load_settings() -> dict:
    """
    Load site settings from settings.json.
    Returns a dict compatible with the old General model.
    """
    if not SETTINGS_FILE.exists():
        return {}

    with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
        settings = json.load(f)

    # Convert to General-compatible format
    social = settings.get('social_links', {})
    about = settings.get('about', {})

    return {
        'youtube_link': social.get('youtube'),
        'vimeo_link': social.get('vimeo'),
        'instagram_link': social.get('instagram'),
        'linkedin_link': social.get('linkedin'),
        'github_link': social.get('github'),
        'about_photo_link': about.get('photo_url'),
        'about_photo_srcset': about.get('photo_srcset'),
        'about_photo_sizes': about.get('photo_sizes'),
    }


def save_settings(settings: dict) -> bool:
    """
    Save site settings to settings.json.
    """
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)

    data = {
        'social_links': {
            'youtube': settings.get('youtube_link', ''),
            'vimeo': settings.get('vimeo_link', ''),
            'instagram': settings.get('instagram_link', ''),
            'linkedin': settings.get('linkedin_link', ''),
            'github': settings.get('github_link', ''),
        },
        'about': {
            'photo_url': settings.get('about_photo_link', ''),
            'photo_srcset': settings.get('about_photo_srcset', ''),
            'photo_sizes': settings.get('about_photo_sizes', ''),
        }
    }

    with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

    _sync_to_s3(SETTINGS_FILE)
    return True


def load_about() -> tuple[str, str, Optional[str]]:
    """
    Load about page content.
    Returns (html_content, markdown_content, revision).
    """
    global _about_cache

    if not ABOUT_FILE.exists():
        _invalidate_about_cache()
        return '', '', None

    mtime_ns, size = _project_stat(ABOUT_FILE)
    now = monotonic()
    with _cache_lock:
        cached = _about_cache
        if cached and cached.mtime_ns == mtime_ns and cached.size == size and _is_fresh(cached.cached_at, now):
            return cached.html_content, cached.markdown_content, cached.revision

    with open(ABOUT_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    _, markdown_content = parse_frontmatter(content)
    html_content = markdown_to_html(markdown_content)
    revision = _revision_from_content(content)

    about_cache_entry = _AboutCacheEntry(
        mtime_ns=mtime_ns,
        size=size,
        cached_at=now,
        html_content=html_content,
        markdown_content=markdown_content,
        revision=revision,
    )
    with _cache_lock:
        _about_cache = about_cache_entry

    return html_content, markdown_content, revision


def save_about(markdown_content: str) -> bool:
    """
    Save about page content and sync to S3.
    """
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)

    # Simple frontmatter for about page
    content = f"---\ntitle: About\n---\n\n{markdown_content}"

    with open(ABOUT_FILE, 'w', encoding='utf-8') as f:
        f.write(content)

    _invalidate_about_cache()
    _sync_to_s3(ABOUT_FILE)
    return True


def _sync_to_s3(filepath: Path) -> None:
    """Best-effort sync a content file to S3 after writing."""
    try:
        from utils.content_sync import sync_to_s3
        sync_to_s3(filepath)
    except Exception:
        logger.exception("Best-effort S3 sync failed for %s", filepath)


def _delete_from_s3(filepath: Path) -> None:
    """Best-effort delete a content file from S3."""
    try:
        from utils.content_sync import delete_from_s3
        delete_from_s3(filepath)
    except Exception:
        logger.exception("Best-effort S3 delete failed for %s", filepath)


def _archive_to_s3(filepath: Path) -> None:
    """Best-effort archive a content file to S3 before deletion."""
    try:
        from utils.content_sync import archive_to_s3
        archive_to_s3(filepath)
    except Exception:
        logger.exception("Best-effort S3 archive failed for %s", filepath)


def format_date(d) -> str:
    """
    Format a date for display.
    """
    if isinstance(d, str):
        try:
            d = datetime.strptime(d, '%Y-%m-%d').date()
        except ValueError:
            return d
    if isinstance(d, (date, datetime)):
        return d.strftime("%B, %Y")
    return str(d) if d else ''


@dataclass
class GeneralInfo:
    """Site settings data class for template rendering."""

    youtube_link: Optional[str] = None
    vimeo_link: Optional[str] = None
    instagram_link: Optional[str] = None
    linkedin_link: Optional[str] = None
    github_link: Optional[str] = None
    about_photo_link: Optional[str] = None
    about_photo_srcset: Optional[str] = None
    about_photo_sizes: Optional[str] = None
    about_content: Optional[str] = None

    @classmethod
    def from_settings(cls, settings: dict) -> "GeneralInfo":
        return cls(
            youtube_link=settings.get("youtube_link"),
            vimeo_link=settings.get("vimeo_link"),
            instagram_link=settings.get("instagram_link"),
            linkedin_link=settings.get("linkedin_link"),
            github_link=settings.get("github_link"),
            about_photo_link=settings.get("about_photo_link"),
            about_photo_srcset=settings.get("about_photo_srcset"),
            about_photo_sizes=settings.get("about_photo_sizes"),
        )


@dataclass
class ProjectInfo:
    """Project data class for template rendering."""

    slug: str
    name: str
    id: int = field(default=0, init=False)
    creation_date: Optional[str] = None
    is_draft: bool = False
    pinned: bool = False
    html_content: str = ""
    markdown_content: str = ""
    video_link: Optional[str] = None
    thumbnail_link: Optional[str] = None
    sprite_sheet_link: Optional[str] = None
    frames: Optional[int] = None
    columns: Optional[int] = None
    rows: Optional[int] = None
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    fps: Optional[int] = None
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    youtube_link: Optional[str] = None
    formatted_date: str = field(default="", init=False)
    og_image_link: Optional[str] = field(default=None, init=False)

    def __post_init__(self):
        self.id = hash(self.slug)
        self.formatted_date = format_date(self.creation_date)
        # Compute og_image_link with fallback chain: thumbnail → spriteSheet
        og_image = self.thumbnail_link or self.sprite_sheet_link
        if og_image and not og_image.startswith(('http://', 'https://')):
            # Resolve relative URL to absolute
            from utils.s3 import CLOUDFRONT_DOMAIN
            og_image = f"https://{CLOUDFRONT_DOMAIN}/{og_image.lstrip('/')}"
        self.og_image_link = og_image

    @classmethod
    def from_dict(cls, data: dict) -> "ProjectInfo":
        return cls(
            slug=data.get("slug", ""),
            name=data.get("name", ""),
            creation_date=data.get("creation_date"),
            is_draft=data.get("is_draft", False),
            pinned=data.get("pinned", False),
            html_content=data.get("html_content", ""),
            markdown_content=data.get("markdown_content", ""),
            video_link=data.get("video_link"),
            thumbnail_link=data.get("thumbnail_link"),
            sprite_sheet_link=data.get("sprite_sheet_link"),
            frames=data.get("frames"),
            columns=data.get("columns"),
            rows=data.get("rows"),
            frame_width=data.get("frame_width"),
            frame_height=data.get("frame_height"),
            fps=data.get("fps"),
            video_width=data.get("video_width"),
            video_height=data.get("video_height"),
            youtube_link=data.get("youtube_link"),
        )
