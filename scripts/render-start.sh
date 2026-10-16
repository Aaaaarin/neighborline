#!/usr/bin/env bash
# Render start command for the `neighborline` web service (render.yaml → startCommand).
#
# PAYPAL_MODE=fake  → also starts tools/fake-paypal on 127.0.0.1:4010 inside the same instance, with
#                     webhooks delivered back to this Next server over loopback. This is the "fake mode"
#                     demo fallback: zero PayPal credentials, deterministic outcomes, no extra Render
#                     service (a private service would cost $7/mo, and a free web service cannot
#                     receive private-network traffic, so fake → web webhooks would not work).
#                     Its state is in memory: it resets on every restart/deploy.
# PAYPAL_MODE=sandbox (default on Render) → only Next runs.
set -euo pipefail

PORT="${PORT:-10000}"
cd "$(dirname "$0")/.."

if [[ "${PAYPAL_MODE:-sandbox}" == "fake" ]]; then
  export FAKE_PAYPAL_PORT="${FAKE_PAYPAL_PORT:-4010}"
  export FAKE_PAYPAL_HOST=127.0.0.1
  export WEBHOOK_TARGET_URL="${WEBHOOK_TARGET_URL:-http://127.0.0.1:${PORT}/api/webhooks/paypal}"
  export FAKE_PAYPAL_URL="${FAKE_PAYPAL_URL:-http://127.0.0.1:${FAKE_PAYPAL_PORT}}"
  echo "[render-start] PAYPAL_MODE=fake → starting embedded fake PayPal on ${FAKE_PAYPAL_URL}"
  (cd tools/fake-paypal && exec node_modules/.bin/tsx src/main.ts) &
fi

echo "[render-start] next start on 0.0.0.0:${PORT} (commit ${RENDER_GIT_COMMIT:-local})"
cd apps/web
# exec so Next receives Render's SIGTERM directly (graceful shutdown on deploys).
exec node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
