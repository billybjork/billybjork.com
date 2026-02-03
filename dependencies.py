from fastapi import HTTPException, Request

from utils.content import GeneralInfo, load_settings


def require_dev_mode(request: Request) -> None:
    """Dependency that ensures the request is actually from localhost (by TCP peer address)."""
    client_host = request.client.host if request.client else None
    if client_host not in ("127.0.0.1", "::1"):
        raise HTTPException(
            status_code=403, detail="Edit mode only available on localhost"
        )


def get_general_info() -> GeneralInfo:
    """Load general info as a compatibility object."""
    settings = load_settings()
    return GeneralInfo.from_settings(settings)
