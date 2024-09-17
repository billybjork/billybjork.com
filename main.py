# uvicorn main:app --reload
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse
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

# Load environment variables
load_dotenv()

app = FastAPI()

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files and templates setup
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Database setup
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

SQLALCHEMY_DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Model definition
class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    creation_date = Column(Date, nullable=False)
    name = Column(Text)
    slug = Column(String, unique=True, index=True)
    html_content = Column(Text)
    thumbnail_link = Column(Text)
    video_link = Column(Text)
    show_thumbnail = Column(Boolean)
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

# Routes
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, db: Session = Depends(get_db)):
    try:
        # Filter projects where show_project is TRUE
        projects = db.query(Project).filter(Project.show_project == True).order_by(Project.creation_date.desc()).all()
        reel_url = os.getenv("REEL_URL")
        return templates.TemplateResponse("index.html", {
            "request": request, 
            "projects": projects,
            "reel_url": reel_url,
            "current_year": datetime.now().year
        })
    except Exception as e:
        print(f"Error in read_root: {str(e)}")  # For debugging
        raise HTTPException(status_code=500, detail="Internal Server Error")
    
@app.get("/{project_slug}", response_class=HTMLResponse)
async def read_project(request: Request, project_slug: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.slug == project_slug).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return templates.TemplateResponse("project_detail.html", {
        "request": request, 
        "project": project
    })

@app.get("/api/projects")
async def get_projects(db: Session = Depends(get_db), skip: int = 0, limit: int = 10):
    projects = db.query(Project).filter(Project.show_project == True).order_by(Project.creation_date.desc()).offset(skip).limit(limit).all()
    return [
        {
            "id": project.id,
            "name": project.name,
            "slug": project.slug,
            "creation_date": project.creation_date,
            "thumbnail_link": project.thumbnail_link,
            "show_thumbnail": project.show_thumbnail,
            "highlight_project": project.highlight_project
        }
        for project in projects
    ]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)