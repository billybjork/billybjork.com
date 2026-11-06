"""Hero sprite sheets: what the generator writes and what the homepage assumes of older ones."""

SPRITE_FPS = 20
DEFAULT_SPRITE_COLUMNS = 5
DEFAULT_SPRITE_DURATION_SECONDS = 3
DEFAULT_SPRITE_FRAMES = DEFAULT_SPRITE_DURATION_SECONDS * SPRITE_FPS


def sprite_rows(frames: int, columns: int) -> int:
    return (frames + columns - 1) // columns
