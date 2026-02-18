# billybjork.com

Personal portfolio site with a file-based CMS, in-browser block editor, and S3-backed media/content persistence.

## Setup

### Requirements

- Python 3.12+
- Node.js 20+
- ffmpeg (required for video processing)
- ImageMagick (optional; sprite generation falls back to ffmpeg)

### Install

```bash
uv sync
npm install
```

### Run Locally

```bash
# Build frontend bundles once
npm run build

# Start API/app server
uv run uvicorn main:app --reload
```

For frontend changes during development, run `npm run watch` in a second terminal.

## Environment Variables

Core infra:

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-west-1
S3_BUCKET=billybjork.com
CLOUDFRONT_DOMAIN=d17y8p6t5eu2ht.cloudfront.net
STATIC_VERSION=
```

Edit mode/auth:

```env
EDIT_TOKEN=
COOKIE_SECRET=
LOCALHOST_EDIT_BYPASS=
```

- `EDIT_TOKEN`: enables remote edit login at `/edit/login`.
- `COOKIE_SECRET`: required in production; used to sign `bb_edit` cookie.
- `LOCALHOST_EDIT_BYPASS`:
  - if `EDIT_TOKEN` is set, default is `false`
  - if `EDIT_TOKEN` is unset, default is `true` (local-only workflow)

## Edit Mode

### Modes

- Local-only mode (no `EDIT_TOKEN`): localhost editing works without login.
- Remote mode (`EDIT_TOKEN` set): authenticate at `/edit/login`, logout at `/edit/logout`.

Admin APIs are gated server-side; UI visibility is controlled by server-auth state, not hostname checks.

### Conflict Handling

Edits use optimistic locking with per-file revision hashes:

- Save request includes `base_revision`
- Server returns `409` on mismatch
- UI offers:
  - `Keep mine` (force save)
  - `Load theirs` (reload server state)

### Content Persistence

Content files are still stored under `content/`, but are synchronized to S3:

- On save: write local file, then sync to S3
- On startup (when `EDIT_TOKEN` is set): hydrate `content/` from S3
- On delete: archive project markdown under `content-archive/` in S3 before removal

This keeps a file-based workflow while surviving redeploys.

## Content Structure

```text
content/
├── about.md
├── assets.json
├── settings.json
└── projects/
    └── {slug}.md
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
youtube: https://youtube.com/watch?v=...
---

Markdown content here...
```

## Media Processing

All media is processed server-side and uploaded to S3/CloudFront.

| Type | Processing | Output |
|------|-----------|--------|
| Images | Resize (max 2000px), convert | WebP @ 80% |
| Content videos | Compress | MP4 @ 720p, crf 28 |
| Hero videos | Full pipeline | HLS adaptive + sprite sheet + thumbnail |

Canonical S3 prefixes used by edit mode:

- `images/project-content/`
- `images/misc/`
- `images/sprite-sheets/`
- `images/thumbnails/`
- `videos/{slug}/`
- `videos_mp4/`

## Static Asset Caching

`/static/*` includes a `?v=` query param for cache busting.

- Set `STATIC_VERSION` in production (git SHA/deploy timestamp).
- If unset, local file mtimes are used in development.
- Static responses use:

```text
Cache-Control: public, max-age=31536000, immutable
```

For CloudFront/S3 assets, set equivalent long-lived cache headers and invalidate updated paths when needed.
