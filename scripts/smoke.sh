#!/usr/bin/env bash
# Production smoke check: every public hostname answers 200 over HTTPS with a
# certificate that is not close to expiring. Exits non-zero on any failure.
# Usage: scripts/smoke.sh [host ...]   (defaults to the apex and www)
set -euo pipefail

hosts=("$@")
[ ${#hosts[@]} -eq 0 ] && hosts=(billybjork.com www.billybjork.com)
min_cert_days=${MIN_CERT_DAYS:-14}
failures=0

fail() { echo "FAIL $1: $2"; failures=$((failures + 1)); }

for host in "${hosts[@]}"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/" 2>&1) || {
    fail "$host" "request failed ($code)"
    continue
  }
  [ "$code" = 200 ] || { fail "$host" "HTTP $code"; continue; }

  not_after=$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null |
    openssl x509 -noout -enddate | cut -d= -f2)
  expires=$(date -j -f '%b %e %T %Y %Z' "$not_after" +%s 2>/dev/null || date -d "$not_after" +%s)
  days=$(((expires - $(date +%s)) / 86400))
  [ "$days" -ge "$min_cert_days" ] || { fail "$host" "certificate expires in ${days}d"; continue; }

  echo "ok   $host (HTTP 200, cert ${days}d)"
done

exit "$failures"
