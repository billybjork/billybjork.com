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


@router.get("/test-3", response_class=HTMLResponse)
async def test_3_page(request: Request):
    """Render the shared-canvas point cloud depth test page."""
    return templates.TemplateResponse(
        "test-3.html",
        {
            "request": request,
            "page_title": "Point Cloud Shared Renderer Test",
            "page_meta_description": "Testing shared-canvas point cloud rendering from RGBD sprite sheets",
        },
    )
