"""Projects: markdown files under content/projects, and the views of them the site renders."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from functools import cached_property, lru_cache

from cms.documents import delete_document, read_document, write_document
from cms.markdown import html_excerpt, markdown_to_html
from cms.paths import get_content_paths
from media.sprite_format import DEFAULT_SPRITE_COLUMNS, DEFAULT_SPRITE_FRAMES, sprite_rows
from object_storage import extract_public_asset_urls, public_asset_url, rewrite_managed_public_url

_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def validate_slug(slug: str) -> bool:
    return bool(_SLUG_PATTERN.match(slug))


def _non_empty_string(value) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    return None


def _positive_int(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value.strip())
        except ValueError:
            return None
    if isinstance(value, (int, float)) and value > 0:
        return int(value) or None
    return None


def _asset_url(value) -> str | None:
    """A stored asset reference as an absolute URL on the current host."""
    text = _non_empty_string(value)
    if not text:
        return None
    if text.startswith(("http://", "https://")):
        return rewrite_managed_public_url(text)
    return public_asset_url(text.lstrip("/"))


def _ratio(width: int | None, height: int | None) -> float | None:
    return width / height if width and height else None


@dataclass(frozen=True)
class ProjectVideo:
    """The `video:` frontmatter. Field names match the stored keys except sprite_sheet."""

    hls: str | None = None
    thumbnail: str | None = None
    sprite_sheet: str | None = None
    frames: int | None = None
    columns: int | None = None
    rows: int | None = None
    frame_width: int | None = None
    frame_height: int | None = None
    fps: int | None = None
    video_width: int | None = None
    video_height: int | None = None

    @classmethod
    def from_stored(cls, raw) -> "ProjectVideo":
        if not isinstance(raw, dict):
            return cls()
        return cls(
            hls=_asset_url(raw.get("hls")),
            thumbnail=_asset_url(raw.get("thumbnail")),
            sprite_sheet=_asset_url(raw.get("spriteSheet")),
            frames=_positive_int(raw.get("frames")),
            columns=_positive_int(raw.get("columns")),
            rows=_positive_int(raw.get("rows")),
            frame_width=_positive_int(raw.get("frame_width")),
            frame_height=_positive_int(raw.get("frame_height")),
            fps=_positive_int(raw.get("fps")),
            video_width=_positive_int(raw.get("video_width")),
            video_height=_positive_int(raw.get("video_height")),
        )

    def to_payload(self) -> dict:
        """Every field under its stored key, absent ones as None."""
        fields = asdict(self)
        sprite_sheet = fields.pop("sprite_sheet")
        hls, thumbnail = fields.pop("hls"), fields.pop("thumbnail")
        return {"hls": hls, "thumbnail": thumbnail, "spriteSheet": sprite_sheet, **fields}

    def to_stored(self) -> dict:
        return {key: value for key, value in self.to_payload().items() if value}

    @property
    def asset_urls(self) -> set[str]:
        return {url for url in (self.hls, self.thumbnail, self.sprite_sheet) if url}

    @property
    def aspect_ratio(self) -> float | None:
        return _ratio(self.video_width, self.video_height)


def format_date(value) -> str:
    if isinstance(value, str):
        try:
            value = datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return value
    if isinstance(value, date):
        return value.strftime("%B, %Y")
    return str(value) if value else ""


@lru_cache(maxsize=512)
def _parse_iso_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return date.min


@dataclass(frozen=True)
class ProjectCard:
    """What a homepage list item shows."""

    slug: str
    name: str
    formatted_date: str
    video_link: str | None = None
    thumbnail_link: str | None = None
    sprite_sheet_link: str | None = None
    frames: int | None = None
    columns: int | None = None
    rows: int | None = None
    frame_width: int | None = None
    frame_height: int | None = None
    sprite_aspect_ratio: float | None = None
    hero_aspect_ratio: float | None = None

    @property
    def has_sprite_animation(self) -> bool:
        return bool(self.sprite_sheet_link)

    @property
    def thumbnail_aspect_ratio(self) -> float | None:
        return self.hero_aspect_ratio or self.sprite_aspect_ratio


@dataclass(frozen=True)
class ProjectInfo:
    slug: str
    name: str = ""
    creation_date: date | str | None = None
    is_draft: bool = False
    pinned: bool = False
    markdown_content: str = ""
    video: ProjectVideo = field(default_factory=ProjectVideo)
    youtube_link: str | None = None
    og_image: str | None = None
    revision: str | None = None

    @cached_property
    def html_content(self) -> str:
        return markdown_to_html(self.markdown_content)

    @property
    def meta_description(self) -> str:
        return html_excerpt(self.html_content)

    @property
    def formatted_date(self) -> str:
        return format_date(self.creation_date)

    @property
    def og_image_link(self) -> str | None:
        return self.og_image or self.video.thumbnail or self.video.sprite_sheet

    @property
    def asset_urls(self) -> set[str]:
        """Every managed asset this project references."""
        return referenced_asset_urls(self.markdown_content, self.video, self.og_image)

    def to_edit_payload(self) -> dict:
        return {
            "slug": self.slug,
            "name": self.name,
            "date": self.creation_date,
            "pinned": self.pinned,
            "draft": self.is_draft,
            "youtube": self.youtube_link,
            "og_image": self.og_image,
            "video": self.video.to_payload(),
            "markdown": self.markdown_content,
            "html": self.html_content,
            "revision": self.revision,
        }

    def to_card(self) -> ProjectCard:
        video = self.video
        sprite_aspect_ratio = _ratio(video.frame_width, video.frame_height)
        sprite_fields = {}
        if video.sprite_sheet:
            frames = video.frames or DEFAULT_SPRITE_FRAMES
            columns = video.columns or DEFAULT_SPRITE_COLUMNS
            sprite_fields = {
                "sprite_sheet_link": video.sprite_sheet,
                "frames": frames,
                "columns": columns,
                "rows": video.rows or sprite_rows(frames, columns),
                "frame_width": video.frame_width,
                "frame_height": video.frame_height,
            }
        return ProjectCard(
            slug=self.slug,
            name=self.name,
            formatted_date=self.formatted_date,
            video_link=video.hls,
            thumbnail_link=video.thumbnail,
            sprite_aspect_ratio=sprite_aspect_ratio,
            hero_aspect_ratio=video.aspect_ratio or sprite_aspect_ratio,
            **sprite_fields,
        )


def referenced_asset_urls(markdown_content: str, video: ProjectVideo, og_image: str | None) -> set[str]:
    urls = extract_public_asset_urls(markdown_content) | video.asset_urls
    if og_image:
        urls.add(og_image)
    return urls


def _project_file(slug: str):
    return get_content_paths().projects_dir / f"{slug}.md"


def load_project(slug: str) -> ProjectInfo | None:
    if not validate_slug(slug):
        return None
    document = read_document(_project_file(slug))
    if not document:
        return None

    frontmatter = document.frontmatter
    return ProjectInfo(
        slug=slug,
        name=_non_empty_string(frontmatter.get("name")) or slug,
        creation_date=frontmatter.get("date"),
        is_draft=frontmatter.get("draft", False),
        pinned=frontmatter.get("pinned", False),
        markdown_content=document.markdown,
        video=ProjectVideo.from_stored(frontmatter.get("video")),
        youtube_link=_non_empty_string(frontmatter.get("youtube")),
        og_image=_asset_url(frontmatter.get("og_image")),
        revision=document.revision,
    )


def load_all_projects(include_drafts: bool = False) -> list[ProjectInfo]:
    """Pinned first, then newest first."""
    projects_dir = get_content_paths().projects_dir
    if not projects_dir.exists():
        return []

    projects = [
        project
        for project in map(load_project, (path.stem for path in projects_dir.glob("*.md")))
        if project and (include_drafts or not project.is_draft)
    ]

    def sort_key(project: ProjectInfo):
        created = project.creation_date
        if isinstance(created, str):
            created = _parse_iso_date(created)
        return (not project.pinned, -(created or date.min).toordinal())

    return sorted(projects, key=sort_key)


def save_project(slug: str, frontmatter: dict, markdown_content: str) -> None:
    write_document(_project_file(slug), frontmatter, markdown_content)


def delete_project(slug: str) -> None:
    path = _project_file(slug)
    if path.exists():
        delete_document(path)
