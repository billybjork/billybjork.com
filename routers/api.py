from fastapi import APIRouter

from utils.content import format_date, load_all_projects

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/projects")
async def get_projects(skip: int = 0, limit: int = 10):
    all_projects = load_all_projects(include_drafts=False)
    projects = all_projects[skip : skip + limit]

    return [
        {
            "id": hash(project.get("slug", "")),
            "name": project.get("name"),
            "slug": project.get("slug"),
            "creation_date": format_date(project.get("creation_date")),
            "sprite_sheet_link": project.get("sprite_sheet_link"),
            "thumbnail_link": project.get("thumbnail_link"),
            "youtube_link": project.get("youtube_link"),
        }
        for project in projects
    ]
