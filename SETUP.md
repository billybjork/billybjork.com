# Setup

This guide is for Riley. You can use a coding agent for repo work, but you are the one doing the human steps in Terminal, Railway, and GitHub.

## The Call

Use Railway for both:

- App hosting
- Object storage

The app now serves bucket files through its own `/media/...` route, so Riley does not need AWS or CloudFront.

## 1. What You Need

- A computer with Terminal access
- A GitHub account
- A Railway account
- Installed tools: Git, Python 3.12+, Node 20+, `uv`, and `ffmpeg`

If any tool is missing, tell your agent:

```text
I'm on macOS. Help me install Git, Python 3.12+, Node 20+, uv, and ffmpeg, then verify the installed versions.
```

## 2. Open Terminal and Get the Repo

- Open Terminal.
- Go to the folder where you keep projects. Example: `cd ~/Projects`
- Use `pwd` to confirm where you are.
- Use `ls` to see what is in the current folder.

Then tell your agent:

```text
Clone <repo-url> into a new folder, open the repo, read README.md and SETUP.md, and tell me the exact repo root I should work from.
```

## 3. First Local Boot

- From the repo root, copy `.env.example` to `.env`.
- Leave the `OBJECT_STORAGE_*` values blank for this first boot.
- Set `CONTENT_STARTUP_SYNC_POLICY=off` in `.env`.
- Leave `EDIT_TOKEN` blank for local work.

Then tell your agent:

```text
From this repo root, install dependencies, build the frontend, start the dev server on port 8001, and tell me the local URL and anything that failed.
```

- Open `http://127.0.0.1:8001`.
- Press `Cmd+E` or `Ctrl+E` to enter edit mode.
- At this stage, text editing works, but uploads and processed media are not ready yet.

## 4. Create the Railway App

- Push the repo to GitHub if it is not there already.
- In Railway, create a new project from the GitHub repo.
- Let Railway build and deploy the app once.
- In the Railway service settings, generate a Railway-provided public domain.
- Copy that domain somewhere safe.

Important:

- Use that Railway-provided domain as the long-term media base URL, even if you later add a custom site domain.
- That avoids rewriting saved asset URLs later.

Your media base URL should look like:

```text
https://<your-railway-domain>/media
```

## 5. Create the Railway Bucket

- In the same Railway project, create a storage bucket.
- Get the bucket credentials.

If you want your agent to help from the repo directory:

```text
Help me create a Railway bucket for this project, then list the values I need from bucket credentials and where each one goes in `.env`.
```

Map the Railway bucket credentials like this:

```env
OBJECT_STORAGE_ACCESS_KEY_ID=<bucket access key id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<bucket secret access key>
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=<bucket name>
OBJECT_STORAGE_ENDPOINT_URL=https://storage.railway.app
OBJECT_STORAGE_PUBLIC_BASE_URL=https://<your-railway-domain>/media
OBJECT_STORAGE_ADDRESSING_STYLE=virtual
OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS=
CONTENT_STARTUP_SYNC_POLICY=always
```

## 6. Add Production Secrets

Also set these:

```env
COOKIE_SECRET=<long random secret>
EDIT_TOKEN=<private edit password>
```

Use the same values in:

- Local `.env`
- Railway service variables

Then tell your agent:

```text
Validate my `.env` for this app, then run `uv run python -m utils.content_sync seed` and `uv run python -m utils.content_sync status`. Tell me if anything still looks wrong.
```

That seed step matters. This app treats object storage as the canonical runtime copy of `content/`.

## 7. Customize the Site

- Best normal workflow: edit content in the browser editor after the bucket is configured.
- Main content files are:
  - `content/settings.json`
  - `content/about.md`
  - `content/projects/*.md`

Useful prompts:

```text
Read README.md and help me replace Billy's site-wide settings with Riley's name, links, and about photo.
```

```text
Create or update project entries from my notes and media, then run the normal verification commands.
```

```text
Clean up sample content I do not want to keep, but ask before deleting anything ambiguous.
```

## 8. Deploy and Smoke-Test

- Confirm the Railway deployment has the same environment variables as your local `.env`.
- Open the Railway public domain.
- Visit `/edit/login` and confirm your `EDIT_TOKEN` works.

Smoke-test:

- Homepage
- `/me`
- A project page
- `/edit/login`
- Image upload
- Save about
- Save project
- Hero video processing, if you plan to use it

Then tell your agent:

```text
Review this repo for Railway deployment, confirm the current `nixpacks.toml` is enough, and list anything still risky or manual.
```

## 9. Custom Domain

If you later add a custom site domain in Railway:

- Point the custom domain to the app as Railway instructs.
- Leave `OBJECT_STORAGE_PUBLIC_BASE_URL` alone if possible.
- Keep using the stable Railway domain for `/media` URLs.

That gives you:

- Main site on your custom domain
- Media on the Railway domain
- No asset migration work

## 10. Normal Workflow After Launch

- Make and verify changes locally first.
- Commit and push.
- Let Railway redeploy.
- For remote edits, go to `https://your-site-domain/edit/login`.
- If you ever must change the media base URL later, use `OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS` during migration.

## Official References

- Railway storage buckets: https://docs.railway.com/storage-buckets
- Railway bucket CLI: https://docs.railway.com/cli/bucket
- Railway variables: https://docs.railway.com/variables
- Railway public networking: https://docs.railway.com/networking/public-networking
