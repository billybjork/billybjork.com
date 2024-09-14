from fastapi import FastAPI, Request, Depends
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, Column, Integer, String, Date, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

# FastAPI setup
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Database setup
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT", "5432")  # Default to 5432 if not specified
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
    preview_text = Column(Text)
    main_text = Column(Text)
    thumbnail_link = Column(Text)
    video_link = Column(Text)
    show_thumbnail = Column(Boolean)
    show_preview_text = Column(Boolean)
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
@app.get("/")
async def read_root(request: Request, db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.creation_date.desc()).all()
    return templates.TemplateResponse("index.html", {"request": request, "projects": projects})

@app.get("/project/{project_id}")
async def read_project(request: Request, project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    return templates.TemplateResponse("project.html", {"request": request, "project": project})

@app.get("/api/projects")
async def get_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.creation_date.desc()).all()
    return [
        {
            "id": project.id,
            "name": project.name,
            "creation_date": project.creation_date,
            "preview_text": project.preview_text,
            "thumbnail_link": project.thumbnail_link,
            "show_thumbnail": project.show_thumbnail,
            "show_preview_text": project.show_preview_text,
            "show_project": project.show_project,
            "highlight_project": project.highlight_project
        }
        for project in projects if project.show_project
    ]

@app.get("/api/project/{project_id}")
async def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if project and project.show_project:
        return {
            "id": project.id,
            "name": project.name,
            "creation_date": project.creation_date,
            "main_text": project.main_text,
            "video_link": project.video_link,
            "youtube_link": project.youtube_link
        }
    return {"error": "Project not found or not visible"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)