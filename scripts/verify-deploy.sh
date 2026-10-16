#!/usr/bin/env bash
# Post-deploy smoke test for the hosted demo.
#   scripts/verify-deploy.sh https://neighborline.onrender.com
#   NEIGHBORLINE_INTERNAL_SECRET=… scripts/verify-deploy.sh https://neighborline.onrender.com   # + internal API checks
# Read-only: no payouts, no messages, no report regeneration.
set -uo pipefail

BASE="${1:?usage: verify-deploy.sh <base-url>}"
BASE="${BASE%/}"
SECRET="${NEIGHBORLINE_INTERNAL_SECRET:-}"
fail=0

check() { # name expected-status-regex method path [curl args...]
  local name="$1" want="$2" method="$3" path="$4"; shift 4
  local t0 code
  t0=$(date +%s)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 -X "$method" "$@" "$BASE$path")
  if [[ "$code" =~ ^($want)$ ]]; then
    printf '  ✓ %-44s %s (%ss)\n' "$name" "$code" "$(( $(date +%s) - t0 ))"
  else
    printf '  ✗ %-44s got %s, want %s\n' "$name" "$code" "$want"; fail=1
  fi
}

echo "Neighborline deploy check → $BASE"
check "GET /api/health (Render health check)"   200     GET  /api/health
check "GET / (landing)"                          200     GET  /
check "GET /demo (judge stage)"                  200     GET  /demo
check "GET /report (transparency report)"        200     GET  /report
check "POST /api/webhooks/paypal rejects junk"   '400|401' POST /api/webhooks/paypal -H 'content-type: application/json' --data '{"id":"WH-junk"}'
check "internal API refuses unsigned calls"      '401|403' POST /api/internal/report-refresh -H 'content-type: application/json' --data '{}'

if [[ -n "$SECRET" ]]; then
  path=/api/internal/report-refresh
  body='{"minNewPayouts":9007199254740991,"force":false,"reason":"manual"}'
  ts=$(date +%s)
  sig="v1=$(printf '%s' "$ts.POST.$path.$body" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')"
  check "internal API accepts signed no-op call"   200   POST "$path" -H 'content-type: application/json' \
    -H "x-neighborline-timestamp: $ts" -H "x-neighborline-signature: $sig" --data "$body"
else
  echo "  - set NEIGHBORLINE_INTERNAL_SECRET to also test a signed internal call"
fi

exit $fail
