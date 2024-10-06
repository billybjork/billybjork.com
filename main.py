from fastapi import FastAPI, Request, Depends, HTTPException, status, Query
from fastapi.responses import HTMLResponse, FileResponse, Response, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.status import HTTP_404_NOT_FOUND, HTTP_500_INTERNAL_SERVER_ERROR
from sqlalchemy import create_engine, Column, Integer, String, Date, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.sql import func
from dotenv import load_dotenv
from datetime import datetime
import logging
import secrets
import os

load_dotenv()

security = HTTPBasic()

app = FastAPI()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Custom middleware to handle 'X-Forwarded-Proto' header
class ForwardedProtoMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        x_forwarded_proto = request.headers.get('x-forwarded-proto')
        if x_forwarded_proto:
            request.scope['scheme'] = x_forwarded_proto
        response = await call_next(request)
        return response

app.add_middleware(ForwardedProtoMiddleware)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

SQLALCHEMY_DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    creation_date = Column(Date, nullable=False)
    name = Column(Text)
    slug = Column(String, unique=True, index=True)
    html_content = Column(Text)
    thumbnail_link = Column(Text)
    # CDN base URL: https://d17y8p6t5eu2ht.cloudfront.net/videos/
    video_link = Column(Text)
    show_project = Column(Boolean)
    youtube_link = Column(Text)

class General(Base):
    __tablename__ = "general"

    id = Column(Integer, primary_key=True, index=True)
    about_content = Column(Text)
    reel_link = Column(String)
    youtube_link = Column(String)
    vimeo_link = Column(String)
    instagram_link = Column(String)
    linkedin_link = Column(String)
    about_photo_link = Column(String)

# Create database tables
Base.metadata.create_all(bind=engine)

# Dependency to get the database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Authentication for /edit functionalities
def check_credentials(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, os.getenv("ADMIN_USERNAME"))
    correct_password = secrets.compare_digest(credentials.password, os.getenv("ADMIN_PASSWORD"))
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

def format_date(date):
    return date.strftime("%B, %Y")

@app.get("/", response_class=HTMLResponse)
async def read_root(
    request: Request, 
    db: Session = Depends(get_db), 
    page: int = Query(1, ge=1), 
    limit: int = Query(10, ge=1, le=100)
):
    try:
        skip = (page - 1) * limit

        # Fetch the current page of projects
        projects = db.query(Project)\
                     .filter(Project.show_project == True)\
                     .order_by(Project.creation_date.desc())\
                     .offset(skip)\
                     .limit(limit)\
                     .all()

        # Format projects
        formatted_projects = []
        for project in projects:
            try:
                formatted_project = {
                    "id": project.id,
                    "name": project.name,
                    "slug": project.slug,
                    "thumbnail_link": project.thumbnail_link,
                    "video_link": project.video_link,
                    "youtube_link": project.youtube_link,
                    "formatted_date": format_date(project.creation_date),
                    "is_open": False  # Default to closed
                }
                formatted_projects.append(formatted_project)
            except Exception as project_error:
                print(f"Error formatting project: {str(project_error)}")
                print(f"Project data: {project.__dict__}")

        # Determine if there are more projects to load
        total_projects = db.query(Project).filter(Project.show_project == True).count()
        has_more = skip + limit < total_projects

        general_info = db.query(General).first()

        # Detect if the request is an HTMX request
        if request.headers.get("HX-Request") == "true":
            return templates.TemplateResponse("_projects.html", {
                "request": request,
                "projects": formatted_projects,
                "page": page,
                "has_more": has_more
            })

        # For non-HTMX requests, render the full page
        return templates.TemplateResponse("index.html", {
            "request": request, 
            "projects": formatted_projects,
            "current_year": datetime.now().year,
            "reel_video_link": general_info.reel_link if general_info else None,
            "general_info": general_info,
            "page": page,
            "has_more": has_more,
            "limit": limit
        })
    except Exception as e:
        print(f"Error in read_root: {str(e)}")
        print(f"Error type: {type(e)}")
        print(f"Error args: {e.args}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.get("/about", response_class=HTMLResponse)
async def read_about(request: Request, db: Session = Depends(get_db)):
    general_info = db.query(General).first()
    about_content = general_info.about_content if general_info else ""
    return templates.TemplateResponse("about.html", {
        "request": request,
        "current_year": datetime.now().year,
        "about_content": about_content,
        "about_photo_link": general_info.about_photo_link if general_info else None,
        "general_info": general_info
    })

@app.get("/about/edit", response_class=HTMLResponse)
async def edit_about(request: Request, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    general_info = db.query(General).first()
    about_content = general_info.about_content if general_info else ""
    about_photo_link = general_info.about_photo_link if general_info else ""
    return templates.TemplateResponse("about_edit.html", {
        "request": request,
        "about_content": about_content,
        "about_photo_link": about_photo_link,
        "tinymce_api_key": os.getenv("TINYMCE_API_KEY"),
        "general_info": general_info
    })

@app.post("/about/edit", response_class=Response)
async def update_about(request: Request, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    form_data = await request.form()
    new_content = form_data["about_content"]
    new_photo_link = form_data["about_photo_link"]

    general = db.query(General).first()
    if general:
        general.about_content = new_content
        general.about_photo_link = new_photo_link
    else:
        new_general = General(about_content=new_content, about_photo_link=new_photo_link)
        db.add(new_general)
    
    db.commit()

    response = Response(status_code=303)
    response.headers["HX-Redirect"] = "/about"
    return response

@app.get("/create-project", response_class=HTMLResponse)
async def create_project_form(request: Request, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    general_info = db.query(General).first()
    return templates.TemplateResponse("project_create.html", {
        "request": request,
        "tinymce_api_key": os.getenv("TINYMCE_API_KEY"),
        "general_info": general_info
    })

@app.post("/create-project", response_class=Response)
async def create_project(request: Request, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    form_data = await request.form()
    
    # Create a new Project instance
    new_project = Project(
        creation_date=datetime.strptime(form_data.get("creation_date"), "%Y-%m-%d").date(),
        name=form_data.get("name"),
        slug=form_data.get("slug"),
        html_content=form_data.get("html_content"),
        thumbnail_link=form_data.get("thumbnail_link"),
        video_link=form_data.get("video_link"),
        show_project="show_project" in form_data,
        youtube_link=form_data.get("youtube_link")
    )
    
    db.add(new_project)
    db.commit()
    
    response = Response(status_code=303)
    response.headers["HX-Redirect"] = f"/{new_project.slug}"
    return response

@app.get("/{project_slug}", response_class=HTMLResponse)
async def read_project(request: Request, project_slug: str, close: bool = False, db: Session = Depends(get_db)):
    try:
        project = db.query(Project).filter(Project.slug == project_slug).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        general_info = db.query(General).first()
        project.formatted_date = format_date(project.creation_date)
        is_open = not close

        if request.headers.get("HX-Request") == "true":
            return templates.TemplateResponse("project.html", {
                "request": request, 
                "project": project,
                "is_open": is_open
            })
        
        # For direct navigation, return the full page with the project open
        projects = db.query(Project).filter(Project.show_project == True).order_by(Project.creation_date.desc()).all()
        for p in projects:
            p.formatted_date = format_date(p.creation_date)
        
        return templates.TemplateResponse("index.html", {
            "request": request, 
            "projects": projects,
            "open_project": project if not close else None,
            "current_year": datetime.now().year,
            "reel_video_link": general_info.reel_link if general_info else None,
            "general_info": general_info
        })
    except HTTPException as http_exc:
        raise http_exc  # Let 404 and other HTTP exceptions be handled by custom handlers
    except Exception as e:
        print(f"Unexpected error in read_project: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
    
@app.get("/get-share-url/{project_slug}")
async def get_share_url(request: Request, project_slug: str):
    base_url = str(request.base_url)
    share_url = f"{base_url}{project_slug}"
    return JSONResponse(content={"share_url": share_url})
    
@app.get("/{project_slug}/edit", response_class=HTMLResponse)
async def edit_project(request: Request, project_slug: str, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    project = db.query(Project).filter(Project.slug == project_slug).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    general_info = db.query(General).first()
    
    return templates.TemplateResponse("project_edit.html", {
        "request": request,
        "project": project,
        "tinymce_api_key": os.getenv("TINYMCE_API_KEY"),
        "general_info": general_info
    })

@app.post("/{project_slug}/edit", response_class=Response)
async def update_project(request: Request, project_slug: str, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    form_data = await request.form()
    project = db.query(Project).filter(Project.slug == project_slug).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    new_slug = form_data.get("slug")
    if new_slug != project_slug:
        # Check if the new slug is already in use
        existing_project = db.query(Project).filter(Project.slug == new_slug).first()
        if existing_project:
            raise HTTPException(status_code=400, detail="Slug already in use")
        project.slug = new_slug

    project.name = form_data.get("name")
    project.html_content = form_data.get("html_content")
    project.youtube_link = form_data.get("youtube_link")
    project.creation_date = datetime.strptime(form_data.get("creation_date"), "%Y-%m-%d").date()
    project.show_project = "show_project" in form_data
    
    db.commit()
    
    response = Response(status_code=303)
    response.headers["HX-Redirect"] = f"/{project.slug}"
    return response

@app.get("/api/projects")
async def get_projects(db: Session = Depends(get_db), skip: int = 0, limit: int = 10):
    projects = db.query(Project).filter(Project.show_project == True).order_by(Project.creation_date.desc()).offset(skip).limit(limit).all()
    return [
        {
            "id": project.id,
            "name": project.name,
            "slug": project.slug,
            "creation_date": format_date(project.creation_date),
            "thumbnail_link": project.thumbnail_link,
            "youtube_link": project.youtube_link
        }
        for project in projects
    ]

@app.get('/favicon.ico', include_in_schema=False)
async def favicon():
    file_name = "assets/favicon.ico"
    file_path = os.path.join(app.root_path, "static", file_name)
    return FileResponse(path=file_path, headers={"Content-Disposition": "attachment; filename=" + file_name})

@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == HTTP_404_NOT_FOUND:
        return templates.TemplateResponse("404.html", {"request": request}, status_code=HTTP_404_NOT_FOUND)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

@app.exception_handler(500)
async def server_error_handler(request: Request, exc: Exception):
    return templates.TemplateResponse("404.html", {"request": request}, status_code=HTTP_500_INTERNAL_SERVER_ERROR)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, debug=True)