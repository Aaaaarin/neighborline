#!/usr/bin/env bash
# Render build command for the `neighborline` web service (render.yaml → buildCommand).
# Runs from the repo root (no rootDir: the web app needs the whole pnpm workspace).
set -euo pipefail

PNPM_VERSION="$(node -p "(require('./package.json').packageManager||'pnpm@10.28.0').split('@')[1]")"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# `corepack pnpm …` runs the pinned pnpm without `corepack enable` (which needs to write next to the
# node binary). Fallback: npx. Both honor package.json#packageManager.
if corepack pnpm --version >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
else
  PNPM=(npx --yes "pnpm@${PNPM_VERSION}")
fi
echo "node $(node -v) · pnpm $("${PNPM[@]}" --version)"

# devDependencies are needed for the build (typescript, tailwind, tsx for the embedded fake PayPal).
# Render sets NODE_ENV=production only at runtime, so a plain install includes them.
"${PNPM[@]}" install --frozen-lockfile

# Build only the web app; workspace packages ship TS source that Next transpiles.
NEXT_TELEMETRY_DISABLED=1 "${PNPM[@]}" --filter @neighborline/web build
