"""
Content management utilities for file-based CMS.
Handles loading and saving markdown files with YAML frontmatter.
"""
import base64
import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import markdown
import yaml
from markdown.extensions.fenced_code import FencedCodeExtension
from markdown.extensions.tables import TableExtension

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
    # Pattern: markers can have flexible whitespace, capture content between them
    pattern = r'<!--\s*html\s*-->\s*\n?(.*?)\n?\s*<!--\s*/html\s*-->'

    def replace(m):
        html = m.group(1)
        # Base64 encode to avoid attribute escaping issues
        encoded = base64.b64encode(html.encode('utf-8')).decode('ascii')
        return f'<div class="html-block-sandbox" data-html-b64="{encoded}"></div>'

    return re.sub(pattern, replace, content, flags=re.DOTALL)


def strip_block_markers(md_content: str) -> str:
    """Remove block separator comments from markdown prior to rendering."""
    return re.sub(r'<!--\s*block\s*-->', '', md_content)


def strip_layout_markers(md_content: str) -> str:
    """Remove row/column layout comments from markdown prior to rendering."""
    return re.sub(r'<!--\s*/?(row|col)\s*-->', '', md_content)


def _convert_markdown(md_content: str) -> str:
    """Convert markdown string to HTML with project-standard extensions."""
    md = markdown.Markdown(extensions=[
        FencedCodeExtension(),
        TableExtension(),
        'nl2br',
        'sane_lists',  # Better list handling - prevents tight coupling with adjacent content
        'smarty',  # Smart quotes and dashes
        'toc',  # Generates IDs for headings (enables anchor links)
    ])
    return md.convert(md_content)


def convert_alignment_comments(html_content: str) -> str:
    """Convert editor alignment comment markers to HTML wrappers."""
    html_content = re.sub(
        r'<!-- align:(center|right) -->',
        r'<div style="text-align: \1">',
        html_content,
    )
    return re.sub(r'<!-- /align -->', '</div>', html_content)


def markdown_to_html(md_content: str) -> str:
    """
    Convert markdown content to HTML.
    Handles block separators and preserves HTML tags.
    """
    md = process_html_blocks(md_content)
    md = strip_block_markers(md)
    md = strip_layout_markers(md)
    html = _convert_markdown(md)
    html = convert_alignment_comments(html)
    return html


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


def load_project(slug: str) -> Optional[dict]:
    """
    Load a project by slug.
    Returns dict with frontmatter fields and 'html_content'.
    """
    if not validate_slug(slug):
        return None
    filepath = PROJECTS_DIR / f"{slug}.md"
    if not filepath.exists():
        return None

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    frontmatter, markdown_content = parse_frontmatter(content)

    # Build project dict
    project = {
        'slug': slug,
        'name': frontmatter.get('name', slug),
        'creation_date': frontmatter.get('date'),
        'is_draft': frontmatter.get('draft', False),
        'pinned': frontmatter.get('pinned', False),
        'youtube_link': frontmatter.get('youtube'),
        'html_content': markdown_to_html(markdown_content),
        'markdown_content': markdown_content,
        'revision': content_revision(filepath),
    }

    # Video fields
    video = frontmatter.get('video', {})
    if video:
        project['video_link'] = video.get('hls')
        project['thumbnail_link'] = video.get('thumbnail')
        project['sprite_sheet_link'] = video.get('spriteSheet')
    else:
        project['video_link'] = None
        project['thumbnail_link'] = None
        project['sprite_sheet_link'] = None

    return project


def load_all_projects(include_drafts: bool = False) -> list[dict]:
    """
    Load all projects from the content directory.
    Returns list of project dicts sorted by date (newest first), with pinned at top.
    """
    projects = []

    if not PROJECTS_DIR.exists():
        return projects

    for filepath in PROJECTS_DIR.glob("*.md"):
        slug = filepath.stem
        project = load_project(slug)
        if project:
            if include_drafts or not project.get('is_draft', False):
                projects.append(project)

    # Sort: pinned first, then by date descending
    def sort_key(p):
        pinned = 1 if p.get('pinned') else 0
        # Handle date sorting
        d = p.get('creation_date')
        if isinstance(d, str):
            try:
                d = datetime.strptime(d, '%Y-%m-%d').date()
            except ValueError:
                d = date.min
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
    if not ABOUT_FILE.exists():
        return '', '', None

    with open(ABOUT_FILE, 'r', encoding='utf-8') as f:
        content = f.read()

    frontmatter, markdown_content = parse_frontmatter(content)
    html_content = markdown_to_html(markdown_content)

    return html_content, markdown_content, content_revision(ABOUT_FILE)


def save_about(markdown_content: str) -> bool:
    """
    Save about page content and sync to S3.
    """
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)

    # Simple frontmatter for about page
    content = f"---\ntitle: About\n---\n\n{markdown_content}"

    with open(ABOUT_FILE, 'w', encoding='utf-8') as f:
        f.write(content)

    _sync_to_s3(ABOUT_FILE)
    return True


def _sync_to_s3(filepath: Path) -> None:
    """Best-effort sync a content file to S3 after writing."""
    try:
        from utils.content_sync import sync_to_s3
        sync_to_s3(filepath)
    except Exception:
        pass  # Never let S3 sync failure break a local save


def _delete_from_s3(filepath: Path) -> None:
    """Best-effort delete a content file from S3."""
    try:
        from utils.content_sync import delete_from_s3
        delete_from_s3(filepath)
    except Exception:
        pass


def _archive_to_s3(filepath: Path) -> None:
    """Best-effort archive a content file to S3 before deletion."""
    try:
        from utils.content_sync import archive_to_s3
        archive_to_s3(filepath)
    except Exception:
        pass


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
    youtube_link: Optional[str] = None
    formatted_date: str = field(default="", init=False)

    def __post_init__(self):
        self.id = hash(self.slug)
        self.formatted_date = format_date(self.creation_date)

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
            youtube_link=data.get("youtube_link"),
        )
