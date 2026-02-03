# billybjork.com

Personal portfolio site with file-based CMS and in-browser editing.

## Setup

```bash
# Install dependencies
uv sync

# Configure environment
cp .env.example .env  # Edit with your credentials

# Run development server
uv run uvicorn main:app --reload
```

### Requirements

- Python 3.9+
- ffmpeg (for video processing)
- ImageMagick (optional, for sprite sheets - falls back to ffmpeg)

### Environment Variables

```
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-west-1
S3_BUCKET=billybjork.com
CLOUDFRONT_DOMAIN=d17y8p6t5eu2ht.cloudfront.net
```

## Content Structure

```
content/
├── about.md           # About page (markdown + frontmatter)
├── settings.json      # Site settings (social links, etc.)
└── projects/          # Project pages
    └── {slug}.md      # Each project as markdown + YAML frontmatter
```

### Project Frontmatter

```yaml
---
name: Project Title
slug: project-slug
date: 2024-01-15
visible: true
pinned: false
video:
  hls: https://cdn.example.com/videos/slug/master.m3u8
  thumbnail: https://cdn.example.com/videos/slug/thumb.webp
  spriteSheet: https://cdn.example.com/videos/slug/sprite.jpg
youtube: https://youtube.com/watch?v=...  # Optional
---

Markdown content here...
```

## Edit Mode

Edit mode is available on localhost only. Access any page and use the floating edit button to:

- Edit content blocks (text, images, videos, code)
- Manage project settings (name, date, visibility)
- Upload and process hero videos
- Upload images (auto-converted to WebP)

## Media Processing

All media is processed server-side and uploaded to S3/CloudFront.

| Type | Processing | Output |
|------|-----------|--------|
| Images | Resize (max 2000px), convert | WebP @ 80% |
| Content videos | Compress | MP4 @ 720p, crf 28 |
| Hero videos | Full pipeline | HLS adaptive + sprite sheet + thumbnail |

### Hero Video Pipeline

When uploading a hero video, the system generates:

1. **HLS streams** - Adaptive bitrate (240p to source resolution)
2. **Sprite sheet** - 60 frames at 20fps for hover preview
3. **Thumbnail** - WebP poster image

See `utils/video.py` for processing details.

## API Endpoints (localhost only)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/upload-media` | Upload and process images |
| `POST /api/process-content-video` | Compress and upload content videos |
| `POST /api/process-hero-video` | Full hero video processing |
| `POST /api/save-project` | Save project content and settings |
| `GET /api/settings` | Get site settings |
