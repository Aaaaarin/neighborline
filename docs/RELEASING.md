# Releasing `@neighborline/paypal` to npm

The package is publish-ready but **not published**: the repository has no npm token yet. Everything below is
automated except the steps marked **(human)**.

## Before the first release

### 1. The npm scope **(human)**

`@neighborline/paypal` is a scoped name, and only the owner of the `neighborline` scope on npm can publish under it.
As of 2026-10-16 the scope is free: `registry.npmjs.org/-/user/neighborline/package` answers `Scope not found`, and no
package uses it. Someone has to claim it before anyone else does.

**Recommendation: create the free npm organization `neighborline` and keep the name `@neighborline/paypal`.**

1. Sign in at npmjs.com with 2FA on, then **Add Organization** → name `neighborline` → **Unlimited public packages
   (free)**. Add a second maintainer, so the scope does not depend on one account.
2. Create a **granular access token**: Packages and scopes → Read and write → only the `@neighborline` scope; expiry
   90 days. (Or a classic *Automation* token, which skips 2FA prompts in CI.)
3. GitHub → Settings → Secrets and variables → Actions → New repository secret `NPM_TOKEN`.
4. Optional: Settings → Environments → `npm` → required reviewers, so a publish needs a second person to click.

Why the scope, and not an unscoped name like `paypal-payouts-guard`:

| | `@neighborline/paypal` (recommended) | `paypal-payouts-guard` (unscoped) |
|---|---|---|
| Code changes | None: every import, doc and the workspace already use it | Rename in `package.json`, imports in `apps/web`, `apps/approver`, `examples/`, and the docs |
| Trademark risk | Low: the scope says whose package it is | Higher: an unscoped name that *starts with* PayPal's mark reads as official. npm's dispute policy lets a trademark holder claim such names, and PayPal publishes its own packages under `@paypal/*` |
| Squatting | Owning the scope protects every future `@neighborline/*` package | One name at a time |
| `npx` | `npx -y --package=@neighborline/paypal neighborline-payouts-mcp` | `npx -y paypal-payouts-guard` |

If the org cannot be created, the unscoped fallback should not start with "paypal": use **`neighborline-payouts`**
(free on 2026-10-16), rename the package and its imports, and keep the bin name `neighborline-payouts-mcp`.

### 2. A public repository **(human)**

npm only attaches **provenance** (a signed statement linking the tarball to this repo, commit and workflow) when the
source repository is public. `publishConfig.provenance` is `true`, so the workflow publishes with provenance, and the
`repository.url` in `packages/paypal/package.json` must match the GitHub repo (`Aaaaarin/neighborline`).

## Every release

1. Bump `version` in `packages/paypal/package.json` **and** `src/version.ts` (a test checks they match). Move the
   CHANGELOG's *Unreleased* entries under `## <version> — <date>` (the workflow refuses a version without one).
2. Locally: `pnpm --filter @neighborline/paypal pack:smoke` packs the tarball, installs it in `/tmp/x` and uses
   every subpath plus the MCP bin against fake PayPal.
3. Commit, push, then GitHub → Actions → **Release @neighborline/paypal** → Run workflow. Run it once with
   **dry run** checked (the default), read the file list, then again unchecked.

The workflow ([`.github/workflows/release-paypal.yml`](../.github/workflows/release-paypal.yml)):

- installs with the frozen lockfile, then typechecks and tests `paypal`, `approver`, `web` and the MCP demo;
- refuses a version that is already on npm or has no CHANGELOG heading;
- builds, packs with **pnpm** and runs `scripts/pack-check.mjs` on the tarball: only `dist/`, the docs and
  `package.json`; every `exports`/`bin` target exists; `types` first in each condition; no `workspace:` ranges; no
  tests, sources, `.env` files or credential-looking strings;
- publishes **that tarball** with `npm publish <tgz> --provenance --access public`.

## Why the tarball and not `npm publish` in the folder

In the workspace, `exports` point at `src/*.ts` so Next.js, vitest and `tsc` use the sources directly. The published
`exports`, `main`, `types` and `bin` live in `publishConfig`, which **pnpm** applies when it packs and **npm
ignores**. So `npm publish` run inside `packages/paypal` would ship exports pointing at files that are not in the
package. A `prepublishOnly` guard refuses it; `pnpm publish` or `npm publish <tarball from pnpm pack>` are the two
correct paths. (`npm pack --dry-run` in the folder lists the same 33 files and is a fine way to eyeball the content.)

## After the first publish

- Add the npm badge to `packages/paypal/README.md`:
  `[![npm](https://img.shields.io/npm/v/@neighborline/paypal)](https://www.npmjs.com/package/@neighborline/paypal)`.
- Replace "Not on npm yet" in that README and the "From a clone, today" paths in [docs/MCP.md](MCP.md).
- Check the provenance badge on the npm page, and `npm audit signatures` in a project that installs it.
