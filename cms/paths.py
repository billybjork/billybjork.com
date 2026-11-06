"""Where content lives. Set once per app at startup; tests point it at a temp root."""
from config import DEFAULT_CONTENT_PATHS, ContentPaths

_content_paths = DEFAULT_CONTENT_PATHS


def get_content_paths() -> ContentPaths:
    return _content_paths


def set_content_paths(paths: ContentPaths) -> None:
    global _content_paths
    _content_paths = paths
