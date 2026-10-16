#!/usr/bin/env node
// `prepublishOnly`: refuse `npm publish` from this folder. npm ignores the publishConfig overrides of
// main/types/exports/bin, so it would publish a package whose exports point at src/*.ts (not shipped).
// Publish the tarball made by `pnpm pack` instead (see .github/workflows/release-paypal.yml), or use `pnpm publish`.
const agent = process.env.npm_config_user_agent ?? '';
if (!agent.startsWith('pnpm/')) {
  console.error('[prepublish-guard] Do not run `npm publish` in packages/paypal. Run `pnpm pack` (or `pnpm --filter @neighborline/paypal pack:check --keep out/`) and `npm publish out/<tarball>.tgz`, or use `pnpm publish`.');
  process.exit(1);
}
