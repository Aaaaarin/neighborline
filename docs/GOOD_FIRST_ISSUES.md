# Good first issues

Each of these is real (re-checked against the code on Oct 16, 2026, evening), small, and testable offline. Comment on the
matching GitHub issue before you start so two people don't take the same one. Setup is in
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

### 1. Add Tagalog (`tl`) to the vetted message catalog

**Why.** `tl` is in the domain's language list, but neighbors who speak Tagalog get status messages through an LLM
translation with a fact check, or in English. A vetted catalog entry is faster, cheaper and safer.

**Files.** `packages/core/src/i18n.ts` (`CATALOG_LANGS`, `CATALOG`), `packages/agents/src/intake/phrases.ts`
(`EXTRA`). Optional: `apps/web/lib/i18n.ts`.

**Done when.** `pnpm --filter @neighborline/core test` and `pnpm --filter @neighborline/agents test` pass, every
`MESSAGE_KEYS` entry exists in `tl` with the same slots as English, and a native speaker has reviewed the wording
(name them in the PR). The steps are in CONTRIBUTING.md, "Adding a language to the message catalog".

**Labels.** `i18n`, `good first issue`

---

### 2. Add ESLint to `packages/core`

**Why.** The root `package.json` has a `lint` script (`pnpm -r --if-present lint`) but no package defines `lint`,
so it does nothing. Start with the pure domain package.

**Files.** `packages/core/package.json` (a `lint` script), an `eslint.config.js` flat config using
`typescript-eslint`, and a CI step in `.github/workflows/ci.yml`.

**Done when.** `pnpm --filter @neighborline/core lint` passes with the recommended type-aware rules, plus a rule
banning floating-point money helpers is a bonus. CI runs `pnpm -r --if-present lint`.

**Labels.** `devex`, `good first issue`

---

### 3. Rail check test: zero-width and bidi characters in a payout handle

**Why.** `normalizeHandle` strips zero-width and bidirectional control characters before comparing handles, which
stops `@eastside​-mutualaid` from slipping past the check (today it is blocked as `DEST_IS_GROUP_HANDLE`).
There is a unit test for `normalizeHandle` itself, but none that goes through `checkHandles`/`checkRail`, so a
refactor of the rail code could lose the protection without a test failing.

**Files.** `packages/core/src/rail.test.ts` (or `handles.test.ts` if you create it).

**Done when.** Tests show that the group handle with an inserted U+200B, U+200D, U+FEFF or U+202E is blocked as
`LOOKALIKE_HANDLE` or `DEST_IS_GROUP_HANDLE`, and that an unrelated handle containing the same characters is not
flagged.

**Labels.** `core`, `security`, `good first issue`

---

## Closed during the hackathon

These were listed here on Oct 16 and have since landed, so they are no longer open:
- Chinese, Arabic, Korean, Russian, French and Tagalog keywords in the offline intake extractor
  (`packages/agents/src/intake/heuristic.ts`).
- Prompt-injection review patterns for Korean, Russian and Tagalog (`packages/core/src/injection.ts`).
- vitest 4 upgrade clearing the dev-dependency advisories.
- `@neighborline/paypal` package metadata (`repository`, `bugs`, `homepage`) and CHANGELOG method names.
- Korean and Russian UI strings for the neighbor's phone (`apps/web/lib/i18n.ts`). A native speaker's review of them
  is still welcome as a PR.
