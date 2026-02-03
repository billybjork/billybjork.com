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
STATIC_VERSION=
```

### Static Asset Caching

Static assets served from `/static/*` now include a version query (`?v=`) for cache busting. In production, set `STATIC_VERSION` (e.g., git SHA or deploy timestamp) to invalidate cached assets on deploy. If `STATIC_VERSION` is unset, the app uses file mtimes for local development.

The app sends long-lived cache headers for `/static/*`:

```
Cache-Control: public, max-age=31536000, immutable
```

For CloudFront/S3 assets (sprite sheets, etc.), ensure the CDN/origin sets the same long-lived `Cache-Control` and invalidate on updates. Use a CloudFront Response Headers Policy or object metadata.

## Content Structure

```
content/
├── about.md           # About page (markdown + frontmatter)
├── assets.json        # Asset registry (hashes, sizes)
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
draft: false
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

### Media Storage Paths

Canonical S3 prefixes used by edit mode and ingestion:

- `images/project-content/` for inline content images (default for `/api/upload-media`)
- `images/misc/` for site-level assets (optional `scope=misc` to `/api/upload-media`)
- `images/sprite-sheets/` for hero video sprite sheets
- `images/thumbnails/` for hero video thumbnails
- `videos/{slug}/` for HLS assets (`master.m3u8`, segments)
- `videos_mp4/` for inline MP4 uploads (`/api/process-content-video`)

### Hero Video Pipeline

When uploading a hero video, the system generates:

1. **HLS streams** - Adaptive bitrate (240p to source resolution)
2. **Sprite sheet** - 60 frames at 20fps for hover preview
3. **Thumbnail** - WebP poster image

See `utils/video.py` for processing details.
