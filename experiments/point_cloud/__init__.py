"""
The /test page: a point-cloud prototype rendered from RGBD sprite sheets.

Everything it owns lives in this folder. The rest of the site does not import
from it except `install`, called from main.create_app.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .router import router

_STATIC_DIR = Path(__file__).parent / "static"


def install(app: FastAPI) -> None:
    """Add the routes and static files. Call before mounting /static, which would shadow them."""
    app.mount("/static/test", StaticFiles(directory=_STATIC_DIR))
    app.include_router(router)
