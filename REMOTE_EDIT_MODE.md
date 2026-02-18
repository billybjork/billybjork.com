# Remote Edit Mode — Design Document

How to turn on cloud/remote edit mode for this file-based CMS without introducing a database, while handling file uploads, content sync, and conflict resolution with minimal complexity.

---

## Current Architecture (localhost only)

```
┌─────────────────────────────────────────────────────────┐
│  Browser (localhost:8000)                                │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ edit-bundle  │  │ Block Editor │  │  Auto-save    │  │
│  │  .js/.css    │  │ (mode.ts)    │  │ (2s debounce) │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼─────────────────┼──────────────────┼──────────┘
          │                 │                  │
          ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI Server                                          │
│                                                          │
│  Guard: require_dev_mode()                               │
│         → checks request.client.host == 127.0.0.1       │
│                                                          │
│  /api/save-project   → write /content/projects/{slug}.md │
│  /api/upload-media   → process → upload to S3/CloudFront │
│  /api/process-hero-video → ffmpeg → HLS → S3            │
│                                                          │
│  Content: /content/projects/*.md  (local filesystem)     │
│  Assets:  /content/assets.json    (local filesystem)     │
│  Config:  /content/settings.json  (local filesystem)     │
└─────────────────────────────────────────────────────────┘
```

**What works well and stays the same:**
- Block editor UI, slash commands, undo/redo, drag-and-drop
- Media upload pipeline (already S3-backed via CloudFront)
- Video processing (HLS encoding, sprite sheets, thumbnails)
- Asset deduplication (SHA-256 content hashing)
- Orphan cleanup on save
- Markdown ↔ HTML pipeline
- Draft system

**What needs to change for remote edit mode:**

| Problem | Current | Remote |
|---|---|---|
| **Who can edit?** | `request.client.host == 127.0.0.1` | Authenticated user with token |
| **Content persistence** | Local filesystem (lost on deploy) | S3-backed with local cache |
| **Concurrent edits** | N/A (single localhost user) | Optimistic locking via content hash |
| **Edit bundle delivery** | `{% if is_dev_mode %}` (hostname check) | `{% if is_edit_mode %}` (auth check) |

---

## Layer 1: Authentication

Single-user personal site → simplest possible auth. No user database, no OAuth, no sessions table.

### Approach: Token → Signed Cookie

```
ENV: EDIT_TOKEN=<random-64-char-secret>
```

```
GET /edit/login           → renders minimal login form
POST /edit/login          → validates token → sets signed cookie → redirect
GET /edit/logout          → clears cookie → redirect
```

**Why a cookie instead of bearer token?**
- The edit bundle is served via `<script>` tag in HTML — can't attach headers to that
- Browser cookie travels automatically with every request (API calls + page loads)
- HttpOnly + Secure + SameSite=Strict = safe from XSS/CSRF

### Implementation sketch

```python
# dependencies.py

import hashlib, hmac, os, time, json, base64
from fastapi import HTTPException, Request

EDIT_TOKEN = os.environ.get("EDIT_TOKEN")  # None = edit mode disabled entirely
COOKIE_SECRET = os.environ.get("COOKIE_SECRET", EDIT_TOKEN)  # reuse or separate
COOKIE_NAME = "bb_edit"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def _sign(payload: str) -> str:
    """HMAC-sign a payload."""
    sig = hmac.new(COOKIE_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _verify(signed: str) -> str | None:
    """Verify an HMAC-signed string. Returns payload or None."""
    if "." not in signed:
        return None
    payload, sig = signed.rsplit(".", 1)
    expected = hmac.new(COOKIE_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig, expected):
        return payload
    return None


def is_edit_mode(request: Request) -> bool:
    """Check if request is from an authenticated editor (cookie or localhost)."""
    # Localhost always has edit access (backwards compatible)
    client_host = request.client.host if request.client else None
    if client_host in ("127.0.0.1", "::1"):
        return True

    # Check signed cookie
    if not EDIT_TOKEN:
        return False
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return False
    payload = _verify(cookie)
    return payload == "editor"


def require_edit_mode(request: Request) -> None:
    """Dependency that ensures the request is from an authenticated editor."""
    if not is_edit_mode(request):
        raise HTTPException(status_code=403, detail="Not authorized")
```

```python
# routers/auth.py — new, minimal

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from dependencies import EDIT_TOKEN, COOKIE_NAME, COOKIE_MAX_AGE, _sign

router = APIRouter(prefix="/edit", tags=["auth"])


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return """
    <form method="POST" action="/edit/login" style="max-width:300px;margin:100px auto">
        <input type="password" name="token" placeholder="Edit token" autofocus
               style="width:100%;padding:8px;margin-bottom:8px">
        <button type="submit" style="width:100%;padding:8px">Enter</button>
    </form>
    """


@router.post("/login")
async def login(request: Request):
    if not EDIT_TOKEN:
        raise HTTPException(status_code=404)
    form = await request.form()
    if form.get("token") != EDIT_TOKEN:
        return RedirectResponse("/edit/login?error=1", status_code=303)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        COOKIE_NAME,
        _sign("editor"),
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="strict",
    )
    return response


@router.get("/logout")
async def logout():
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(COOKIE_NAME)
    return response
```

### What changes

| File | Change |
|---|---|
| `dependencies.py` | `require_dev_mode()` → `require_edit_mode()` |
| `routers/admin.py` | `dependencies=[Depends(require_edit_mode)]` |
| `routers/pages.py` | `_is_localhost()` → `is_edit_mode()` for `is_dev_mode` template var |
| `templates/base.html` | No change needed (`is_dev_mode` var just gets renamed/reused) |
| `static/ts/core/utils.ts` | `isDevMode()` checks a server-injected var instead of hostname |
| `routers/auth.py` | New — 3 endpoints, ~40 lines |

### Frontend `isDevMode()` change

```typescript
// Before:
export function isDevMode(): boolean {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

// After:
export function isDevMode(): boolean {
  // Server injects this data attribute when user is authenticated for editing
  return document.body.dataset.editMode === 'true';
}
```

```html
<!-- templates/base.html — add data attribute -->
<body data-edit-mode="{{ 'true' if is_edit_mode else 'false' }}"
      data-isolation-mode="{{ 'true' if isolation_mode else 'false' }}"
      ...>
```

---

## Layer 2: Content Persistence (S3-backed filesystem)

### The problem

Railway containers are ephemeral. Content written to `/content/projects/*.md` is lost on redeploy. Media is already safe (S3), but markdown files, `assets.json`, and `settings.json` are not.

### Approach: S3 as source of truth, local filesystem as cache

```
                    ┌──────────────┐
  On save ─────────►│  Local disk  │──── sync ────►  S3
                    │  /content/   │               s3://bucket/content/
                    └──────────────┘
                          ▲
  On app startup ─────────┘◄──── sync ────  S3
```

**Write path** (on every save):
1. Write to local filesystem (fast, existing behavior)
2. Upload the same file to S3 at `content/{relative_path}`

**Read path** (always local filesystem — fast, no latency):
- No change. Files are already on disk.

**Startup sync** (on app boot):
1. List all files under `s3://bucket/content/`
2. Download each to `/content/` (overwriting stale local copies)
3. App is now ready with fresh content

This means:
- Every edit is immediately durable in S3
- Deploys automatically get latest content on startup
- Local filesystem is just a cache for fast reads
- No database. No new dependencies. Uses the existing S3 bucket.

### Implementation sketch

```python
# utils/content_sync.py — new, ~60 lines

import logging
from pathlib import Path
from utils.s3 import s3_client, S3_BUCKET

logger = logging.getLogger(__name__)

CONTENT_DIR = Path(__file__).parent.parent / "content"
S3_CONTENT_PREFIX = "content/"

# Files to sync (explicit allowlist — no accidental sync of .pyc, etc.)
SYNC_PATTERNS = ["projects/*.md", "about.md", "settings.json", "assets.json"]


def sync_to_s3(local_path: Path) -> None:
    """Upload a single content file to S3 after a local write."""
    relative = local_path.relative_to(CONTENT_DIR)
    s3_key = f"{S3_CONTENT_PREFIX}{relative}"

    with open(local_path, "rb") as f:
        s3_client.upload_fileobj(
            f, S3_BUCKET, s3_key,
            ExtraArgs={"ContentType": _content_type(local_path)},
        )
    logger.info(f"Synced to S3: {s3_key}")


def sync_from_s3() -> None:
    """Download all content files from S3 to local filesystem (startup)."""
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_CONTENT_PREFIX):
        for obj in page.get("Contents", []):
            s3_key = obj["Key"]
            relative = s3_key[len(S3_CONTENT_PREFIX):]
            local_path = CONTENT_DIR / relative

            # Ensure parent directories exist
            local_path.parent.mkdir(parents=True, exist_ok=True)

            s3_client.download_file(S3_BUCKET, s3_key, str(local_path))
            logger.info(f"Synced from S3: {s3_key} → {local_path}")


def _content_type(path: Path) -> str:
    if path.suffix == ".md":
        return "text/markdown"
    if path.suffix == ".json":
        return "application/json"
    return "application/octet-stream"
```

### Integrating with existing save functions

The save functions in `utils/content.py` are the single write point. Add S3 sync there:

```python
# utils/content.py — additions

from utils.content_sync import sync_to_s3

def save_project(slug: str, frontmatter: dict, markdown_content: str) -> bool:
    # ... existing code ...
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    # Sync to S3 for persistence across deploys
    sync_to_s3(filepath)

    return True

# Same pattern for save_about(), save_settings(), and the asset registry writes
```

### Startup sync in `main.py`

```python
# main.py — add before app startup

from utils.content_sync import sync_from_s3

# Sync content from S3 on startup (remote edits survive redeploys)
if os.environ.get("EDIT_TOKEN"):  # Only when remote edit is enabled
    try:
        sync_from_s3()
    except Exception as e:
        logger.warning(f"S3 content sync failed (using local files): {e}")
```

### What about `assets.json`?

`assets.json` tracks uploaded media hashes for deduplication. It's already modified by `register_asset()` in `utils/assets.py`. That function needs the same S3 sync treatment:

```python
# utils/assets.py — after writing assets.json
sync_to_s3(ASSETS_FILE)
```

### Cost / complexity

- **S3 storage**: Markdown files are tiny (< 1 KB each). Even 1000 projects = < 1 MB. Effectively free.
- **S3 calls**: One PUT per save (2-second debounced, so ~1 call per edit session). One LIST + N GETs on startup.
- **New code**: ~60 lines for `content_sync.py`, ~5 one-line additions to existing save functions.
- **New dependencies**: None (already using boto3).

---

## Layer 3: Conflict Resolution

### The problem

With remote edit mode, two scenarios can cause data loss:

1. **Two browser tabs** editing the same project → Tab A saves, Tab B overwrites with stale content
2. **Phone + laptop** editing simultaneously → same problem
3. **Auto-save race**: Auto-save fires in Tab A while Tab B also auto-saves

Currently there is zero conflict handling (not even for localhost). Remote edit mode makes this worth addressing.

### Approach: Optimistic Locking via Content Hash

Every content file has a deterministic hash. Use it as a version token.

```
Load:  GET /api/project/foo  →  { markdown: "...", revision: "sha256:abc123" }
Save:  POST /api/save-project  →  { slug: "foo", markdown: "...", base_revision: "sha256:abc123" }
                                                                     ▲
                                                              "this is what I loaded"
```

**On save, server checks:**
```
current file hash == base_revision?
├── YES → save normally, return new revision hash
└── NO  → 409 Conflict, return { server_revision, server_content, your_content }
```

### Implementation sketch

```python
# utils/content.py — add revision support

import hashlib

def _content_hash(filepath: Path) -> str | None:
    """Compute SHA-256 hash of a file's contents."""
    if not filepath.exists():
        return None
    content = filepath.read_bytes()
    return "sha256:" + hashlib.sha256(content).hexdigest()[:16]  # 16 hex chars = plenty


def load_project(slug: str) -> dict | None:
    # ... existing code ...
    project = { ... }

    # Add revision hash for conflict detection
    filepath = PROJECTS_DIR / f"{slug}.md"
    project["revision"] = _content_hash(filepath)

    return project
```

```python
# routers/admin.py — save endpoint with conflict check

@router.post("/save-project")
async def save_project_endpoint(request: Request):
    data = await request.json()
    slug = data.get("slug")
    base_revision = data.get("base_revision")  # what the client loaded

    # ... validation ...

    # Conflict check
    filepath = PROJECTS_DIR / f"{slug}.md"
    current_revision = _content_hash(filepath)

    if base_revision and current_revision and base_revision != current_revision:
        # Someone else changed the file since this client loaded it
        current_project = load_project(slug)
        return JSONResponse(
            status_code=409,
            content={
                "conflict": True,
                "server_revision": current_revision,
                "server_markdown": current_project.get("markdown_content", ""),
                "your_markdown": data.get("markdown", ""),
                "message": "Content was modified by another session",
            },
        )

    # ... existing save logic ...

    # Return new revision after save
    new_revision = _content_hash(filepath)
    return {"success": True, "slug": slug, "revision": new_revision}
```

### Frontend conflict handling

```typescript
// In the auto-save function (mode.ts)

let currentRevision: string | null = null;  // set on load

async function save() {
  const response = await fetchJSON('/api/save-project', {
    method: 'POST',
    body: JSON.stringify({
      slug,
      markdown,
      base_revision: currentRevision,
      // ... other fields
    }),
  });

  if (response.status === 409) {
    // Pause auto-save, show conflict banner
    pauseAutoSave();
    showConflictBanner(response.data);
    return;
  }

  // Update revision for next save
  currentRevision = response.data.revision;
}
```

### Conflict resolution UI

Keep it simple — two options:

```
┌─────────────────────────────────────────────────┐
│  ⚠ Content was modified in another session      │
│                                                  │
│  [Keep mine]          [Load theirs]              │
│                                                  │
│  "Keep mine" overwrites the server version.      │
│  "Load theirs" reloads with the latest content.  │
└─────────────────────────────────────────────────┘
```

- **Keep mine**: Re-sends the save with `force: true` (skips conflict check) and resumes auto-save
- **Load theirs**: Reloads the editor with the server's content and revision, resumes auto-save

No merge UI. No diff viewer. Those add complexity for a scenario that's rare on a single-user site. The banner is just insurance against the edge case.

### About page + settings

Same pattern: `load_about()` returns a revision, `save_about()` checks it. Settings too, but settings conflicts are even less likely (rarely edited).

---

## Layer 4: Delete Safety

Deleting a project is destructive and irreversible (removes files from S3 too). With remote access, accidental deletion is higher risk.

### Approach: Soft delete with S3 archive

Before deleting a project, stash the full markdown file in an S3 archive prefix:

```python
# On delete: copy to s3://bucket/content-archive/projects/{slug}_{timestamp}.md
# Then proceed with normal deletion
```

This is a ~5 line addition. Archived files can be manually recovered if needed. No UI needed — this is just a safety net.

---

## Complete Data Flow (Remote Edit Mode)

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (any device, anywhere)                                   │
│                                                                   │
│  1. Navigate to site → cookie present? → edit UI loads            │
│  2. Edit content → 2s debounce → POST /api/save-project          │
│     { slug, markdown, base_revision: "sha256:abc123" }           │
│  3. Upload image → POST /api/upload-media → S3 → CloudFront URL  │
│  4. Upload video → POST /api/video-thumbnails → background HLS   │
└──────────────────────────────────────┬───────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI Server (Railway)                                         │
│                                                                   │
│  Startup:  sync_from_s3() → /content/* is fresh                  │
│                                                                   │
│  Auth:     require_edit_mode()                                    │
│            └─ localhost? → OK                                     │
│            └─ valid signed cookie? → OK                           │
│            └─ else → 403                                          │
│                                                                   │
│  Save:     check base_revision vs current file hash               │
│            ├─ match → write file → sync_to_s3() → return revision │
│            └─ mismatch → 409 Conflict                             │
│                                                                   │
│  Media:    unchanged (already S3)                                 │
│  Video:    unchanged (ffmpeg → S3)                                │
└──────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  S3 + CloudFront                                                  │
│                                                                   │
│  content/projects/*.md       ← markdown files (synced)           │
│  content/about.md            ← about page (synced)               │
│  content/settings.json       ← site settings (synced)            │
│  content/assets.json         ← asset registry (synced)           │
│  content-archive/            ← deleted project backups           │
│  images/                     ← uploaded images (existing)        │
│  videos/                     ← HLS streams (existing)            │
│  videos_mp4/                 ← inline MP4s (existing)            │
└──────────────────────────────────────────────────────────────────┘
```

---

## What Changes, File by File

| File | Change | Lines |
|---|---|---|
| `dependencies.py` | Replace `require_dev_mode` with `require_edit_mode`, add cookie signing | ~40 |
| `routers/auth.py` | **New** — login/logout endpoints | ~40 |
| `routers/admin.py` | Import change + conflict check in save endpoints | ~25 |
| `routers/pages.py` | `_is_localhost()` → `is_edit_mode()` import | ~5 |
| `utils/content.py` | Add `_content_hash()`, add revision to loads, sync calls in saves | ~20 |
| `utils/content_sync.py` | **New** — S3 sync for content files | ~60 |
| `utils/assets.py` | Add `sync_to_s3()` call after writing `assets.json` | ~2 |
| `main.py` | Add startup sync + auth router include | ~5 |
| `templates/base.html` | Add `data-edit-mode` attribute to `<body>` | ~1 |
| `static/ts/core/utils.ts` | `isDevMode()` reads `data-edit-mode` attribute | ~3 |
| `static/ts/edit/mode.ts` | Track `currentRevision`, handle 409 conflict | ~30 |
| `.env` | Add `EDIT_TOKEN` | ~1 |

**Total: ~230 lines of new/changed code across ~12 files.**

Two new files (`auth.py`, `content_sync.py`), everything else is small modifications to existing code.

---

## What Stays Exactly the Same

- Block editor UI (mode.ts, blocks.ts, slash.ts, undo.ts)
- Media upload + deduplication pipeline
- Video processing (HLS, sprite sheets, thumbnails)
- Project creation and deletion flow (just adds archive on delete)
- Markdown ↔ HTML rendering
- Template system
- CSS/styling
- RSS feed
- Analytics
- All middleware (cache, security headers, gzip)
- Local development workflow (localhost still works, no token needed)

---

## Environment Variables

```bash
# Existing
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-west-1
S3_BUCKET=billybjork.com
CLOUDFRONT_DOMAIN=d17y8p6t5eu2ht.cloudfront.net

# New (only these two)
EDIT_TOKEN=<random-64-char-string>     # enables remote edit mode
COOKIE_SECRET=<random-64-char-string>  # optional, defaults to EDIT_TOKEN
```

When `EDIT_TOKEN` is not set, remote edit mode is completely disabled and the system behaves exactly as it does today (localhost only). This means the feature is opt-in with zero risk to the existing setup.

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Token brute force | Rate limiting on `/edit/login` (add after basic implementation) |
| Cookie theft (XSS) | `HttpOnly` flag — JavaScript cannot read the cookie |
| Cookie replay (MITM) | `Secure` flag — only sent over HTTPS |
| CSRF | `SameSite=Strict` — cookie not sent on cross-origin requests |
| Token in env var | Standard practice for secrets on Railway/Heroku/etc. |
| Edit bundle exposure | Bundle is JS for a block editor, not a security risk. Auth protects the API, not the UI code. |
| S3 content access | Same IAM credentials already used for media. Content prefix is not publicly accessible via CloudFront (only media paths are). |

---

## Alternatives Considered

### Why not a database?

The file-based approach is the best feature of this CMS:
- Content is human-readable markdown files
- Version history via git
- Easy backup (it's just files)
- Zero operational overhead

Adding a database would mean: migrations, connection pooling, ORM, a new failure mode, and losing the elegant simplicity of `content/projects/my-project.md`.

### Why not git push on every save?

Considered auto-committing and pushing to GitHub on every save. Problems:
- Auto-save fires every 2 seconds — that's a git commit every 2 seconds
- Git push adds 1-3 seconds of latency per save
- Merge conflicts in git are harder to resolve than the simple "keep mine / load theirs" approach
- Would need git credentials on the server

S3 sync is simpler, faster (< 100ms PUT), and doesn't pollute git history.

### Why not WebSocket for real-time sync?

Real-time collaborative editing (like Google Docs) would require:
- Operational Transform or CRDT algorithms
- WebSocket server with connection management
- Cursor presence, selection sync
- Massive complexity increase

This is a single-user personal site. The conflict banner handles the rare edge case. Real-time sync is overkill.

### Why not Railway persistent volumes?

Railway volumes would solve persistence without S3 sync, but:
- Vendor lock-in to Railway
- Can't easily migrate to another host
- No built-in backup (S3 has versioning)
- Single region (S3 can be replicated)

S3 is portable and works with any hosting provider.
