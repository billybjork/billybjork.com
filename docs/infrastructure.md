# Infrastructure

What runs production, where each piece is configured, and how to check it.
`just smoke` probes the public hostnames; `just domains` prints Railway's view
of the custom domains.

## Map

| Piece | Vendor | Configured in |
| --- | --- | --- |
| App (FastAPI, `nixpacks.toml`) | Railway, project and service `billybjork.com`, environment `production` | Railway dashboard / `railway` CLI |
| Runtime env vars | Railway service variables | `railway variables`; `.env.example` documents each one |
| DNS | Cloudflare, zone `billybjork.com` | Cloudflare dashboard / API |
| Registrar | Squarespace Domains (migrated from Google Domains) | Squarespace, signed in with Billy's personal Google account |
| Email | Google Workspace | Workspace Admin console |
| Media | S3 behind CloudFront (`CLOUDFRONT_DOMAIN`) | AWS |

## DNS

Cloudflare is authoritative. Records, all DNS-only (grey cloud) so Railway
terminates TLS and issues its own certificates:

| Name | Type | Target | Why |
| --- | --- | --- | --- |
| `billybjork.com` | CNAME (flattened at the apex) | `dp05nhne.up.railway.app` | Railway custom domain |
| `www` | CNAME | `qqj8m13k.up.railway.app` | Railway custom domain |
| `_railway-verify` | TXT | `railway-verify=…` | Railway ownership proof for the apex custom domain |
| `billybjork.com` | MX ×5 | `aspmx.l.google.com` and `alt1`–`alt4` | Workspace mail |
| `billybjork.com` | TXT | `google-site-verification=…` ×2 | Workspace and Search Console ownership |
| `billybjork.com` | TXT | `v=spf1 include:_spf.google.com ~all` | SPF: Workspace is the only sender |
| `google._domainkey` | TXT | `v=DKIM1; k=rsa; p=…` | DKIM key for Workspace (Admin console → Gmail → Authenticate email) |
| `_dmarc` | TXT | `v=DMARC1; p=none; …` | DMARC, monitor-only; tighten to `quarantine` once reports show only Google sending |

The Railway targets come from Railway, not from us: `just domains` shows the
record each custom domain requires and whether it has propagated. Point
hostnames at those names, never at an IP; Railway moves its edge IPs
(`docs/retrospectives/2026-09-29-apex-outage.md`).

Zone settings: SSL mode Full, Always Use HTTPS on. Both only take effect for
proxied records; they are set so turning the proxy on later is safe.

## Checking production

- `just smoke` fails on any hostname that does not return 200 over HTTPS or
  whose certificate expires within 14 days. `.github/workflows/smoke.yml` runs
  it on a schedule; GitHub emails on failure.
- A certificate stuck in `ISSUING` or `VALIDATING_OWNERSHIP` in `just domains`
  means Railway cannot see a record it requires: the traffic CNAME, or for a
  newly added domain the `_railway-verify` TXT. Fix DNS first; the
  certificate follows.
