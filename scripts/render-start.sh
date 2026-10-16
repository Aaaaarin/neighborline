#!/usr/bin/env bash
# Render start command for the `neighborline` web service (render.yaml → startCommand).
#
# Two processes in one instance, separated by environment (docs/DEPLOY.md "Approver process"):
#
#   approver  apps/approver on 127.0.0.1:4020 (loopback only). The ONLY process that receives
#             PAYPAL_PAYOUTS_CLIENT_ID/SECRET. It is started with an empty environment plus an
#             allow-list, and its secrets arrive as JSON on stdin, so they never appear in any
#             process's /proc/<pid>/environ.
#   web       Next.js on $PORT. Started WITHOUT any PAYPAL_PAYOUTS_* variable.
#
# The HMAC key between them (NEIGHBORLINE_APPROVER_SECRET) is generated fresh on every boot unless
# set, and exists only in these two processes. If the approver exits, the instance is stopped so
# Render restarts both.
#
# PAYPAL_MODE=fake → also starts tools/fake-paypal on 127.0.0.1:4010 (demo fallback, zero PayPal
#                    credentials; its state is in memory and resets on every restart/deploy).
set -euo pipefail

PORT="${PORT:-10000}"
APPROVER_PORT="${APPROVER_PORT:-4020}"
cd "$(dirname "$0")/.."

export APP_BASE_URL="${APP_BASE_URL:-${RENDER_EXTERNAL_URL:-}}"
if [[ "${SKIP_EMBEDDED_APPROVER:-}" == "true" ]]; then
  # The approver runs as its own Render private service (render.yaml, commented block).
  : "${APPROVER_URL:?SKIP_EMBEDDED_APPROVER=true needs APPROVER_URL}" "${NEIGHBORLINE_APPROVER_SECRET:?and NEIGHBORLINE_APPROVER_SECRET}"
else
  export NEIGHBORLINE_APPROVER_SECRET="${NEIGHBORLINE_APPROVER_SECRET:-$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')}"
  export APPROVER_URL="http://127.0.0.1:${APPROVER_PORT}"
fi

if [[ "${PAYPAL_MODE:-sandbox}" == "fake" ]]; then
  export FAKE_PAYPAL_PORT="${FAKE_PAYPAL_PORT:-4010}"
  export FAKE_PAYPAL_HOST=127.0.0.1
  export WEBHOOK_TARGET_URL="${WEBHOOK_TARGET_URL:-http://127.0.0.1:${PORT}/api/webhooks/paypal}"
  export FAKE_PAYPAL_URL="${FAKE_PAYPAL_URL:-http://127.0.0.1:${FAKE_PAYPAL_PORT}}"
  echo "[render-start] PAYPAL_MODE=fake → starting embedded fake PayPal on ${FAKE_PAYPAL_URL}"
  (cd tools/fake-paypal && exec node_modules/.bin/tsx src/main.ts) &
fi

start_approver() {
# Secrets for the approver, as JSON on stdin (empty values are dropped by the approver).
APPROVER_SECRETS="$(node -e '
  const k = ["NEIGHBORLINE_APPROVER_SECRET","DATABASE_URL","PAYPAL_PAYOUTS_CLIENT_ID","PAYPAL_PAYOUTS_CLIENT_SECRET","PAYPAL_PAYOUTS_WEBHOOK_ID"];
  if (process.env.APPROVER_ALLOW_SHARED_CREDENTIALS === "true") k.push("PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET");
  process.stdout.write(JSON.stringify(Object.fromEntries(k.map((n) => [n, process.env[n] || ""]))));
')"

echo "[render-start] approver on 127.0.0.1:${APPROVER_PORT} (only process with Payouts credentials)"
printf '%s' "$APPROVER_SECRETS" | (cd apps/approver && exec env -i \
  PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV="${NODE_ENV:-production}" \
  APPROVER_CONFIG_STDIN=1 APPROVER_PORT="$APPROVER_PORT" APPROVER_HOST=127.0.0.1 \
  PAYPAL_MODE="${PAYPAL_MODE:-sandbox}" PAYPAL_BASE_URL="${PAYPAL_BASE_URL:-}" FAKE_PAYPAL_URL="${FAKE_PAYPAL_URL:-}" \
  APPROVER_ALLOW_SHARED_CREDENTIALS="${APPROVER_ALLOW_SHARED_CREDENTIALS:-}" \
  DEMO_MODE="${DEMO_MODE:-true}" NEIGHBORLINE_REQUIRE_PASSKEYS="${NEIGHBORLINE_REQUIRE_PASSKEYS:-}" \
  WEBAUTHN_ORIGIN="${WEBAUTHN_ORIGIN:-}" WEBAUTHN_RP_ID="${WEBAUTHN_RP_ID:-}" APP_BASE_URL="${APP_BASE_URL:-}" \
  RENDER_GIT_COMMIT="${RENDER_GIT_COMMIT:-}" \
  node_modules/.bin/tsx src/main.ts) &
APPROVER_PID=$!
unset APPROVER_SECRETS

# Supervisor: if the approver dies, stop the instance ($$ becomes the Next process after exec).
( while kill -0 "$APPROVER_PID" 2>/dev/null; do sleep 5; done
  echo "[render-start] approver exited; stopping the instance so Render restarts it" >&2
  kill -TERM $$ 2>/dev/null || true ) &
}
[[ "${SKIP_EMBEDDED_APPROVER:-}" == "true" ]] || start_approver

echo "[render-start] next start on 0.0.0.0:${PORT} (commit ${RENDER_GIT_COMMIT:-local}); Payouts variables removed from its environment"
cd apps/web
# exec so Next receives Render's SIGTERM directly (graceful shutdown on deploys).
exec env -u PAYPAL_PAYOUTS_CLIENT_ID -u PAYPAL_PAYOUTS_CLIENT_SECRET -u PAYPAL_PAYOUTS_WEBHOOK_ID -u APPROVER_ALLOW_SHARED_CREDENTIALS \
  node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
