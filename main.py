# uvicorn main:app --reload
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Date, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import os
from unidecode import unidecode

load_dotenv()

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

# Create database tables
Base.metadata.create_all(bind=engine)

# Dependency to get the database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

REEL_VIDEO_LINK = os.getenv("REEL_VIDEO_LINK")

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
async def read_about(request: Request):
    return templates.TemplateResponse("about.html", {
        "request": request,
        "current_year": datetime.now().year
    })
    
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