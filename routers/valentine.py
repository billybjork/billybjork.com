"""Valentine's Day route with 3D Gaussian splat gallery."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from config import templates

router = APIRouter()


@router.get("/will-you-be-my-valentine", response_class=HTMLResponse)
async def valentine_page(request: Request):
    """Render the Valentine's Day 3D gallery page."""
    return templates.TemplateResponse(
        "valentine.html",
        {
            "request": request,
            "page_title": "Will You Be My Valentine?",
            "page_meta_description": "A special Valentine's Day message",
        },
    )
