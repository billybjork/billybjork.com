# billybjork.com

Personal portfolio site with server-rendered public pages, a file-based CMS, in-browser block editing, media processing, and S3-compatible object-storage persistence.

## Agent Orientation

- In a normal git clone, this directory is the repo root. In Billy's larger local workspace, the repo happens to live under `src/`.
- Start here, then inspect `.env.example`, `main.py`, `config.py`, `routers/`, `utils/content.py`, `utils/content_sync.py`, and `utils/object_storage.py`.
- Localhost editing works when `EDIT_TOKEN` is unset. Use `Cmd/Ctrl+E` to enter edit mode, or load `/me?edit` for the about page.
- The app can boot without object storage, but uploads, hero-video processing, and durable media URLs assume a configured S3-compatible bucket plus a stable public asset base URL.
- Railway-first setup now works by storing bucket objects privately and serving them publicly through the app at `/media/{object_key}`.
- For meaningful changes, verify with `npm test`, `npm run typecheck`, `npm run build`, and `uv run python -m unittest discover -s tests -p 'test_*.py'`.

## Purpose

This app is the richer portfolio implementation. The extracted baseline lives in [`portfolio-kit`](https://github.com/billybjork/portfolio-kit), but this repo keeps the extra behavior that site needs in production:

- FastAPI server-side rendering
- markdown-based content storage
- live edit mode with auth
- project CRUD plus about/settings editing
- image and video processing/uploads
- homepage runtime, analytics, `/test`, and seasonal routes
- local development storage with optional object-storage-backed persistence

## Quick Start

1. Copy `.env.example` to `.env` and fill in the values you need.
2. Install backend and frontend dependencies.
3. Build frontend assets once before starting the app.
4. Run the FastAPI app with the factory entrypoint.
5. In a second terminal, run `npm run watch` while changing frontend code.

## Setup

### Requirements

- Python 3.12+
- Node.js 20+
- `uv`
- ffmpeg (required for video processing)
- ImageMagick (optional; sprite generation falls back to ffmpeg)

### Install

```bash
cp .env.example .env
uv sync
npm install
npm run build
```

If object storage is not configured yet and you only want a first local boot, set this in `.env` before starting the app:

```env
CONTENT_STARTUP_SYNC_POLICY=off
```

### Run Locally

```bash
uv run uvicorn main:create_app --factory --reload --port 8001
```

For frontend changes during development, run `npm run watch` in a second terminal.
`static/build/` is generated, cleaned on each build, and should not be committed.

Local-first notes:

- Leave `EDIT_TOKEN` unset for localhost-only editing.
- Without object storage, text/content edits still work locally, but uploads and processed media flows are not fully usable.
- Once object storage is ready, seed it with `uv run python -m utils.content_sync seed` and switch `CONTENT_STARTUP_SYNC_POLICY` back to `always`.

## Route Surface

Public routes:

- `/` homepage
- `/me` about page
- `/{slug}` project page
- `/feed.xml`

Supporting routes:

- `/home` redirects to `/`
- `/about` redirects to `/me`
- `/edit/login`
- `/edit/logout`
- `/media/*` object-storage-backed public media
- `/api/*` editor and content-management endpoints
- `/test` and `/test/{slug}` for local sprite/test views
- `/will-you-be-my-valentine` for the seasonal page

## Project Context

- Prefer borrowing maintainability and testability patterns from `portfolio-kit` without flattening this app's richer video, homepage runtime, analytics, `/test`, or valentine behavior.
- `main.py` exposes `create_app()` plus the default `app`. Dotenv loading, analytics DB init, content-root wiring, startup content sync, and temp-video cleanup wiring all happen at FastAPI startup rather than import time.
- `config.py` owns runtime-resolved app settings, auth settings, content paths, and Jinja template setup.
- `routers/pages.py` handles the public site, partial responses, redirects, and analytics-triggering detail fetches.
- `routers/auth.py` handles edit login/logout.
- `routers/admin.py` handles editor APIs, optimistic saves, uploads, hero-video processing, cleanup, and settings writes.
- `utils.content` is the canonical content layer. It supports runtime-swappable content roots for tests while preserving the existing markdown/frontmatter and project video metadata formats.
- Favor getter-based or injected auth/content configuration over import-time snapshots when touching backend setup.

## Verification

```bash
# Frontend interaction regression suite
npm test

# TypeScript compile checks
npm run typecheck

# Generated bundle verification
npm run build

# Python route regression checks
uv run python -m unittest discover -s tests -p 'test_*.py'
```

## Environment Variables

Use `.env.example` as the copyable source of truth for local setup.

Core infra:

```env
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ENDPOINT_URL=
OBJECT_STORAGE_PUBLIC_BASE_URL=
OBJECT_STORAGE_ADDRESSING_STYLE=
OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS=
STATIC_VERSION=
```

Edit mode/auth:

```env
EDIT_TOKEN=
COOKIE_SECRET=
LOCALHOST_EDIT_BYPASS=
CONTENT_STARTUP_SYNC_POLICY=always
TEMP_VIDEO_CLEANUP_INTERVAL_SECONDS=900
APP_PORT=8001
```

- `EDIT_TOKEN`: enables remote edit login at `/edit/login`.
- `COOKIE_SECRET`: required in production; used to sign `bb_edit` cookie.
- `LOCALHOST_EDIT_BYPASS`:
  - if `EDIT_TOKEN` is set, default is `false`
  - if `EDIT_TOKEN` is unset, default is `true` (local-only workflow)
- `CONTENT_STARTUP_SYNC_POLICY`:
  - `always` (default): always sync from object storage at startup
  - `guarded`: sync only when the canonical marker exists
  - `off`: skip startup content sync
- `TEMP_VIDEO_CLEANUP_INTERVAL_SECONDS`: background cleanup loop interval for temp video/HLS session state.
- `APP_PORT`: local `python main.py` port override. Defaults to `8001`.

`OBJECT_STORAGE_PUBLIC_BASE_URL` is the public host used in saved markdown/frontmatter URLs.  
`OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS` is optional and lets the app rewrite older stored asset hosts at read time during migrations.

Important: this app stores fully qualified asset URLs in content/frontmatter. In deployed environments, `OBJECT_STORAGE_PUBLIC_BASE_URL` must be a stable public base that can actually serve those files.

For Railway-first deploys, use the app domain with the media route:

```env
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_ENDPOINT_URL=https://storage.railway.app
OBJECT_STORAGE_ADDRESSING_STYLE=virtual
OBJECT_STORAGE_PUBLIC_BASE_URL=https://<your-stable-railway-domain>/media
```

Recommended practice: keep using the stable Railway-provided domain for `OBJECT_STORAGE_PUBLIC_BASE_URL` even if you later add a custom site domain. That avoids rewriting saved asset URLs.

Legacy compatibility: the older `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, and `CLOUDFRONT_DOMAIN` variables are still accepted as fallbacks, but new deploys should use the `OBJECT_STORAGE_*` names.

## Hosting Recommendation

Recommended fit for the current codebase:

- Railway for app hosting
- Railway buckets for object storage

Why this matters:

- The app persists public asset URLs directly in markdown/frontmatter and emits those URLs to the browser.
- Railway buckets are private by default, so the app now serves them through `/media/*` instead of assuming a public bucket or CDN origin.
- This keeps Riley on one provider and removes the AWS + CloudFront setup burden.

Tradeoff:

- Media now flows through the app on public requests, which is simpler to set up but less efficient than a dedicated CDN if traffic grows significantly.

If you later migrate public asset hosts:

1. Copy existing objects into the new bucket, preserving object keys.
2. Set `OBJECT_STORAGE_PUBLIC_BASE_URL` to the new public base.
3. Set `OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS` to the old public base while migrating.
4. Optionally rewrite content files in place:

```bash
uv run python tools/rewrite_asset_base_urls.py --apply
```

## Edit Mode

### Modes

- Local-only mode (no `EDIT_TOKEN`): localhost editing works without login.
- Remote mode (`EDIT_TOKEN` set): authenticate at `/edit/login`, logout at `/edit/logout`.

Local shortcut: `Cmd/Ctrl+E` enters edit mode on project pages and `/me`.

Admin APIs are gated server-side; UI visibility is controlled by server-auth state, not hostname checks.

### Editor Scope

Supported block types:

- `text`
- `image`
- `video`
- `code`
- `html`
- `callout`
- `divider`
- `row`

Editing expectations:

- live markdown preview/rendering
- project CRUD plus about/settings editing
- image uploads and video-processing workflows
- optimistic locking and conflict handling

Markdown rendering should continue to support reasonable raw HTML for legacy content and explicit HTML blocks.

### Conflict Handling

Edits use optimistic locking with per-file revision hashes:

- Save request includes `base_revision`
- Server returns `409` on mismatch
- UI offers:
  - `Keep mine` (force save)
  - `Load theirs` (reload server state)

## Content Structure

```text
content/
├── about.md
├── assets.json
├── settings.json
├── test_projects.json
└── projects/
    └── {slug}.md
```

- `content/about.md` stores the about page markdown.
- `content/settings.json` stores site-level metadata and profile/contact fields.
- `content/assets.json` stores upload deduplication metadata and storage keys.
- `content/test_projects.json` powers the local `/test` route.

### Project Frontmatter

```yaml
---
name: Project Title
slug: project-slug
date: 2024-01-15
draft: false
pinned: false
og_image: https://cdn.example.com/images/custom-og.webp # optional override
video:
  hls: https://cdn.example.com/videos/slug/master.m3u8
  thumbnail: https://cdn.example.com/videos/slug/thumb.webp # hero poster (always frame 0)
  spriteSheet: https://cdn.example.com/videos/slug/sprite.jpg
youtube: https://youtube.com/watch?v=...
---

Markdown content here...
```

## Content Persistence

Content files are still stored under `content/`, but are synchronized to S3-compatible object storage:

- On save: write local file, then sync to object storage
- On startup (all environments): hydrate `content/` from object storage, controlled by `CONTENT_STARTUP_SYNC_POLICY`
- On delete: archive project markdown under `content-archive/` before removal

Uploaded media and processed video assets assume configured object storage plus a working public asset base URL. In the Railway-first setup, that public base should point to the app's `/media` route rather than the bucket endpoint itself.

### Canonical Source Guardrails

Recommended model: **object storage is runtime source of truth**, Git is backup/export.

Important: direct local edits under `content/` are not canonical by themselves.  
To publish those edits, run `uv run python -m utils.content_sync seed` (or save through the admin UI/API, which already writes to object storage).

Before relying on startup sync in a new environment, seed object storage explicitly:

```bash
uv run python -m utils.content_sync seed
```

Optional strict seed that also removes stale keys:

```bash
uv run python -m utils.content_sync seed --delete-extra
```

Check marker/status:

```bash
uv run python -m utils.content_sync status
```

The seed command uploads all `content/` files and writes `content/.object-storage-canonical.json`.  
With default `CONTENT_STARTUP_SYNC_POLICY=always`, startup sync always uses object-storage content in both localhost and production.

## Media Processing

All media is processed server-side and uploaded to the configured object-storage bucket/public base.

| Type | Processing | Output |
|------|-----------|--------|
| Images | Resize (max 2000px), convert | WebP @ 80% |
| Content videos | Compress | MP4 @ 720p, crf 28 |
| Hero videos | Full pipeline | HLS adaptive + sprite sheet + first-frame poster |

Canonical object key prefixes used by edit mode:

- `images/project-content/`
- `images/misc/`
- `images/sprite-sheets/`
- `images/thumbnails/`
- `videos/{slug}/`
- `videos_mp4/`

Public delivery path:

- Saved URLs should normally look like `https://<your-stable-railway-domain>/media/<object_key>`
- The app reads the object from storage and serves it back with the stored content type and cache headers

### Hero Poster and OG Behavior

- `video.thumbnail` is the hero poster and is always generated from frame `0`.
- `og_image` is optional and independent from hero poster generation.
- OG resolution priority is:
  1. `og_image` (if set)
  2. `video.thumbnail`
  3. `video.spriteSheet`

### One-off Poster Regeneration

To regenerate hero posters from frame `0` for all hero-video projects and clean up replaced orphaned assets:

```bash
uv run python tools/regenerate_hero_posters_first_frame.py --apply --cleanup-orphans
```

## Static Asset Caching

`/static/*` includes a `?v=` query param for cache busting.

- Set `STATIC_VERSION` in production (git SHA/deploy timestamp).
- If unset, local file mtimes are used in development.
- Static responses use:

```text
Cache-Control: public, max-age=31536000, immutable
```

`/media/*` responses reuse the object's stored cache headers. Uploaded media currently sets long-lived cache headers at upload time.

## Conventions

- Prefer straightforward code over abstractions.
- Preserve the markdown-first authoring flow.
- Keep documentation aligned with the current repository structure.
- Note verification gaps clearly if you cannot run the full frontend, backend, typecheck, and build suite.
