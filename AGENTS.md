billybjork.com is Billy's portfolio site: a FastAPI app with server-rendered
templates, a TypeScript frontend bundled by esbuild, and an in-page edit mode.
Railway hosts it; a push to `main` deploys production.

## Start here

1. `README.md` §"Agent Orientation" maps the code and local setup;
   `.env.example` documents every environment variable.
2. `docs/infrastructure.md` owns hosting, DNS, email, and media: which vendor
   runs each piece and where it is configured. Read it before touching
   domains, deploys, or env vars.
3. `just` lists the entrypoints: `just setup`, `just dev`, `just check`,
   `just smoke`, `just domains`.

## Ground rules

- **One definition of green.** `just check` is the gate: frontend tests,
  typecheck, bundle build, and Python route tests. Run it before anything
  lands on `main`. Never weaken a check or a test to pass.
- **Production is one push away.** `main` deploys on push, so anything
  destructive or user-facing (DNS, env vars, deleting media, content
  migrations) needs Billy's go-ahead first. After a deploy or an infra
  change, `just smoke` confirms the site answers.
- **Surface decisions, don't guess.** When work depends on a product, vendor,
  or spending call, ask Billy with a recommended default and finish the parts
  that do not depend on it.
- **Comments and docs state what is true now.** No history in code or
  runbooks; incidents go in `docs/retrospectives/YYYY-MM-DD-*.md`.
- **Secrets never enter the repo.** `.env` locally, Railway service variables
  in production. The repo is public.
- **Prefer a check to a paragraph.** A rule worth keeping becomes a test or a
  script (`scripts/smoke.sh`); keep this file an index.
