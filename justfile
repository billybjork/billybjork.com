# billybjork.com developer entrypoints. `just` lists them. `just check` is the
# one definition of green.

set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list --unsorted

# Install Python and Node dependencies.
setup:
    uv sync
    npm install

# Run the app locally with reload, rebuilding the frontend bundle on change.
dev:
    trap 'kill 0' EXIT; npm run watch & uv run uvicorn main:create_app --factory --reload --port 8001

# The gate: frontend tests, typecheck, bundle build, and Python route tests.
check:
    npm test
    npm run typecheck
    npm run build
    uv run python -m unittest discover -s tests -p 'test_*.py'

# Probe production: HTTP 200 and a healthy certificate on every hostname.
smoke *hosts:
    scripts/smoke.sh {{hosts}}

# Railway's view of the custom domains: required DNS target and cert status.
domains:
    scripts/railway-domains.sh
