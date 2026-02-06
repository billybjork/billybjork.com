"""Test route for exploring RGBD depth displacement effects."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from config import templates

router = APIRouter()


@router.get("/test", response_class=HTMLResponse)
async def test_page(request: Request):
    """Render the RGBD displacement shader test page."""
    return templates.TemplateResponse(
        "test.html",
        {
            "request": request,
            "page_title": "RGBD Depth Test",
            "page_meta_description": "Testing depth displacement effects using Video Depth Anything",
        },
    )
