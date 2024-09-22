from fastapi import FastAPI, Request, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, FileResponse, Response
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy import create_engine, Column, Integer, String, Date, Text, Boolean, DateTime, desc
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.sql import func
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import secrets
import os

load_dotenv()

security = HTTPBasic()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    video_link = Column(Text)
    video_link_mp4 = Column(Text)
    show_project = Column(Boolean)
    youtube_link = Column(Text)
    highlight_project = Column(Boolean)

class General(Base):
    __tablename__ = "general"

    id = Column(Integer, primary_key=True, index=True)
    about_content = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# Create database tables
Base.metadata.create_all(bind=engine)

# Dependency to get the database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Get reel link from env variable - to move into db later
REEL_VIDEO_LINK = os.getenv("REEL_VIDEO_LINK")

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
async def read_root(request: Request, db: Session = Depends(get_db)):
    try:
        projects = db.query(Project).filter(Project.show_project == True).order_by(Project.creation_date.desc()).all()
        for project in projects:
            project.formatted_date = format_date(project.creation_date)
        return templates.TemplateResponse("index.html", {
            "request": request, 
            "projects": projects,
            "current_year": datetime.now().year,
            "reel_video_link": REEL_VIDEO_LINK
        })
    except Exception as e:
        print(f"Error in read_root: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.get("/about", response_class=HTMLResponse)
async def read_about(request: Request, db: Session = Depends(get_db)):
    about_content = db.query(General.about_content).first()
    about_content = about_content[0] if about_content else ""
    print(f"Fetched about_content: {about_content}")  # Add this line for debugging
    return templates.TemplateResponse("about.html", {
        "request": request,
        "current_year": datetime.now().year,
        "about_content": about_content
    })

@app.get("/about/edit", response_class=HTMLResponse)
async def edit_about(request: Request, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    about_content = db.query(General.about_content).first()
    about_content = about_content[0] if about_content else ""
    return templates.TemplateResponse("about_edit.html", {
        "request": request,
        "about_content": about_content,
        "tinymce_api_key": os.getenv("TINYMCE_API_KEY")
    })

@app.post("/about/edit", response_class=Response)
async def update_about(request: Request, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    form_data = await request.form()
    new_content = form_data["about_content"]

    # Update the existing row or create a new one if it doesn't exist
    general = db.query(General).first()
    if general:
        general.about_content = new_content
    else:
        new_general = General(about_content=new_content)
        db.add(new_general)
    
    db.commit()

    response = Response(status_code=303)
    response.headers["HX-Redirect"] = "/about"
    return response

@app.get("/{project_slug}", response_class=HTMLResponse)
async def read_project(request: Request, project_slug: str, db: Session = Depends(get_db)):
    try:
        project = db.query(Project).filter(Project.slug == project_slug).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # If it's an HTMX request, return only the project content
        if request.headers.get("HX-Request") == "true":
            return templates.TemplateResponse("project.html", {
                "request": request, 
                "project": project
            })
        
        # For direct navigation, return the full page with the project open
        projects = db.query(Project).filter(Project.show_project == True).order_by(Project.creation_date.desc()).all()
        for p in projects:
            p.formatted_date = format_date(p.creation_date)
        
        return templates.TemplateResponse("index.html", {
            "request": request, 
            "projects": projects,
            "current_year": datetime.now().year,
            "reel_video_link": REEL_VIDEO_LINK,
            "open_project": project
        })
    except Exception as e:
        print(f"Error in read_project: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
    
@app.get("/{project_slug}/edit", response_class=HTMLResponse)
async def edit_project(request: Request, project_slug: str, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    project = db.query(Project).filter(Project.slug == project_slug).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return templates.TemplateResponse("project_edit.html", {
        "request": request,
        "project": project,
        "tinymce_api_key": os.getenv("TINYMCE_API_KEY")
    })


@app.post("/{project_slug}/edit", response_class=Response)
async def update_project(request: Request, project_slug: str, db: Session = Depends(get_db), username: str = Depends(check_credentials)):
    form_data = await request.form()
    project = db.query(Project).filter(Project.slug == project_slug).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project.name = form_data.get("name")
    project.html_content = form_data.get("html_content")
    project.youtube_link = form_data.get("youtube_link")
    project.creation_date = datetime.strptime(form_data.get("creation_date"), "%Y-%m-%d").date()
    project.show_project = "show_project" in form_data
    project.highlight_project = "highlight_project" in form_data
    
    db.commit()
    
    response = Response(status_code=303)
    response.headers["HX-Redirect"] = f"/{project_slug}"
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
            "youtube_link": project.youtube_link,
            "highlight_project": project.highlight_project
        }
        for project in projects
    ]

@app.get('/favicon.ico', include_in_schema=False)
async def favicon():
    file_name = "favicon.ico"
    file_path = os.path.join(app.root_path, "static", file_name)
    return FileResponse(path=file_path, headers={"Content-Disposition": "attachment; filename=" + file_name})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, debug=True)