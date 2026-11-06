from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from templating import templates

router = APIRouter()


@router.get("/will-you-be-my-valentine", response_class=HTMLResponse)
async def valentine_page(request: Request):
    return templates.TemplateResponse(
        request,
        "valentine.html",
        {
            "page_title": "Will You Be My Valentine?",
            "page_meta_description": "A special Valentine's Day message",
        },
    )
