"""Test route for exploring point cloud rendering from RGBD sprite sheets."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from config import templates

router = APIRouter()


@router.get("/test-2", response_class=HTMLResponse)
async def test_2_page(request: Request):
    """Render the point cloud depth test page."""
    return templates.TemplateResponse(
        "test-2.html",
        {
            "request": request,
            "page_title": "Point Cloud Depth Test",
            "page_meta_description": "Testing point cloud rendering from RGBD sprite sheets",
        },
    )
