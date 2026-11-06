# billybjork.com

Personal portfolio site: server-rendered public pages, a file-based CMS, in-browser block editing, media processing, and persistence to S3-compatible object storage.

## Code map

Imports point down this list; `tests/test_architecture.py` enforces it.

| Where | What it owns |
| --- | --- |
| `main.py` | `create_app()`: wiring, startup, error pages |
| `routers/` | HTTP: `pages` (public site), `media` (`/media/*`), `feed`, `auth`, `admin` (content APIs), `admin_media` (upload and video APIs), `valentine` |
| `experiments/point_cloud/` | The self-contained `/test` prototype: route, templates, static files, tools |
| `edit_auth.py`, `client_address.py`, `analytics.py`, `templating.py` | Who may edit, who is asking, page-view stats, Jinja setup |
| `cms/` | Content on disk: `projects`, `about`, `site_settings`, `documents` (frontmatter files), `markdown` (rendering), `sync` (to and from object storage), `assets` (registry and orphan cleanup) |
| `media/` | `image`, `video` (ffmpeg), `hero_sessions` (the hero video workflow's state), `uploads` (dedupe), `keys` (bucket layout) |
| `object_storage.py`, `config.py` | The bucket and public URLs; settings |
| `static/ts/` | Frontend, one esbuild bundle per entry (`esbuild.config.mjs`): `homepage/`, `project/`, `edit/`, shared `core/` |

## Setup

Requires Python 3.12+, Node 20+, `uv`, `just`, and ffmpeg (ImageMagick optional: sprite generation falls back to ffmpeg).

```bash
just setup
cp .env.example .env   # or: fnox exec -- just dev, with production-like secrets
just dev               # http://localhost:8001, rebuilding the frontend on change
```

Without object storage, set `CONTENT_STARTUP_SYNC_POLICY=off` for a first boot: text edits work locally, uploads and video processing do not.

`just check` is the gate. `just` lists the other entrypoints.

## Environment

`.env.example` lists every variable. `docs/infrastructure.md` says what production uses.

- `EDIT_TOKEN` enables remote edit login at `/edit/login`. `COOKIE_SECRET` signs its cookie and defaults to the token.
- `LOCALHOST_EDIT_BYPASS` lets localhost edit without login. Defaults to on only when `EDIT_TOKEN` is unset.
- `CONTENT_STARTUP_SYNC_POLICY`: `always` (default) pulls `content/` from object storage at startup; `guarded` does so only once the canonical marker exists; `off` skips it.
- `OBJECT_STORAGE_*` configure any S3-compatible bucket. `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` and `CLOUDFRONT_DOMAIN` are accepted in their place, and are what production sets.
- `OBJECT_STORAGE_PUBLIC_BASE_URL` (or `CLOUDFRONT_DOMAIN`) is the host written into saved content URLs. `OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS` lists older hosts rewritten to it at read time. For a bucket that isn't public, point the base at the app's own `/media` route.
- `STATIC_VERSION` is the `?v=` cache-buster for `/static/*`, served as immutable. File mtimes are used when unset.

To move public asset hosts: copy objects preserving keys, set the new base and list the old one as legacy, then optionally `uv run python tools/rewrite_asset_base_urls.py --apply`.

## Routes

Public: `/`, `/me`, `/{slug}` (a project; `?_partial=1` returns just its detail fragment), `/feed.xml`, `/media/*`, `/test`, `/will-you-be-my-valentine`.

Editing: `/edit/login`, `/edit/logout`, `/api/*` (gated server-side by `edit_auth.require_edit_mode`). `Cmd/Ctrl+E` enters edit mode on project pages and `/me`.

## Content

```text
content/
├── about.md
├── assets.json       upload dedupe registry
├── settings.json     social links, about photo
└── projects/{slug}.md
```

Project frontmatter:

```yaml
---
name: Project Title
slug: project-slug
date: 2024-01-15
draft: false
pinned: false
og_image: https://cdn.example.com/images/custom-og.webp # optional
video:
  hls: https://cdn.example.com/videos/slug/1700000000/master.m3u8
  thumbnail: https://cdn.example.com/images/thumbnails/slug_1700000000.webp # always frame 0
  spriteSheet: https://cdn.example.com/images/sprite-sheets/slug_1700000000_sprite_sheet.jpg
youtube: https://youtube.com/watch?v=...
---
```

The OG image is `og_image`, else `video.thumbnail`, else `video.spriteSheet`.

**Object storage is the runtime source of truth; git is a backup.** Saves write the local file and then upload it, startup pulls everything back, and deletes archive to `content-archive/` first. Direct edits under `content/` are not canonical until published:

```bash
uv run python -m cms.sync seed                 # upload content/ and write the canonical marker
uv run python -m cms.sync seed --delete-extra  # also remove stale keys
uv run python -m cms.sync status
```

Saves use optimistic locking: a request carries `base_revision`, a mismatch returns `409`, and the editor offers `Keep mine` (force) or `Load theirs`.

## Media

| Type | Processing | Output |
| --- | --- | --- |
| Images | Resize (max 2000px) | WebP @ 80%, deduplicated by content |
| Content videos | Compress | MP4 @ 720p, crf 28 |
| Hero videos | Full pipeline | HLS ladder, sprite sheet, poster of frame 0 |

`media/keys.py` defines the object keys.
