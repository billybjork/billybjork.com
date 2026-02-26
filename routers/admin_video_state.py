import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Optional

TIMELINE_INITIAL_FRAME_COUNT = 6
TIMELINE_TOTAL_FRAME_COUNT = 20
TIMELINE_FRAME_WIDTH = 96
TIMELINE_FRAME_HEIGHT = 54


@dataclass
class TempVideoState:
    path: str
    frames: list[str]
    frames_complete: bool = False
    is_remote: bool = False
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class HlsSessionState:
    status: str = "processing"
    stage: str = "Starting HLS encoding..."
    progress: float = 0
    hls_url: Optional[str] = None
    temp_id: Optional[str] = None
    slug: str = ""
    error: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)


class TempVideoStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, TempVideoState] = {}

    def create(self, temp_id: str, **kwargs: Any) -> None:
        with self._lock:
            self._items[temp_id] = TempVideoState(**kwargs)

    def update(self, temp_id: str, **kwargs: Any) -> bool:
        with self._lock:
            state = self._items.get(temp_id)
            if not state:
                return False
            for key, value in kwargs.items():
                setattr(state, key, value)
            return True

    def get(self, temp_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            state = self._items.get(temp_id)
            return asdict(state) if state else None

    def pop(self, temp_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            state = self._items.pop(temp_id, None)
            return asdict(state) if state else None

    def delete(self, temp_id: str) -> bool:
        with self._lock:
            return self._items.pop(temp_id, None) is not None

    def exists(self, temp_id: str) -> bool:
        with self._lock:
            return temp_id in self._items

    def snapshot(self) -> list[tuple[str, dict[str, Any]]]:
        with self._lock:
            return [(temp_id, asdict(state)) for temp_id, state in self._items.items()]


class HlsSessionStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, HlsSessionState] = {}

    def create(self, session_id: str, **kwargs: Any) -> None:
        with self._lock:
            self._items[session_id] = HlsSessionState(**kwargs)

    def update(self, session_id: str, **kwargs: Any) -> bool:
        with self._lock:
            state = self._items.get(session_id)
            if not state:
                return False
            for key, value in kwargs.items():
                setattr(state, key, value)
            return True

    def get(self, session_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            state = self._items.get(session_id)
            return asdict(state) if state else None

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._items.pop(session_id, None) is not None

    def snapshot(self) -> list[tuple[str, dict[str, Any]]]:
        with self._lock:
            return [(session_id, asdict(state)) for session_id, state in self._items.items()]


temp_video_files = TempVideoStore()
hls_sessions = HlsSessionStore()


def is_remote_video_source(path: str) -> bool:
    return isinstance(path, str) and (
        path.startswith("http://") or path.startswith("https://")
    )
