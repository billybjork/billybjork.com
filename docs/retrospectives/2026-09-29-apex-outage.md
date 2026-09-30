# 2026-09-29: apex domain offline

## What happened

`https://billybjork.com/` timed out while `https://www.billybjork.com/` kept
working. The apex had a hard-coded A record, `35.212.162.221`, which was an
old Railway edge IP that no longer answered. `www` was a CNAME to Railway's
hostname and followed Railway's move to its new edge on its own. With the apex
record wrong, Railway also could not renew the apex certificate, so it had
expired as well.

## Why it lasted

- DNS was hosted at Squarespace (inherited from Google Domains). Squarespace
  does not allow a CNAME at the apex, which is why the record was an IP.
- The domain sat in a Squarespace account tied to a Google sign-in that was
  hard to find, so even a one-record fix was slow.
- Nothing watched the apex.
- Once DNS was right, Railway stayed in `ISSUING` for over 20 minutes after
  its long run of failures. Removing and re-adding the apex custom domain
  restarted issuance; the re-added domain needed a new CNAME target and a
  `_railway-verify` TXT record before the certificate was issued.

## Fixes

- DNS moved to Cloudflare. The apex is a CNAME, flattened at the apex, to the
  target Railway specifies, so it follows future IP moves.
- `just smoke` checks both hostnames and certificate expiry;
  `.github/workflows/smoke.yml` runs it on a schedule.
- `just domains` shows the DNS record Railway requires for each custom domain.
- `docs/infrastructure.md` records where each piece lives.
