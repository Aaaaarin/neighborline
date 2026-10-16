# Good first issues

Each of these is real (checked against the code on Oct 16, 2026), small, and testable offline. Comment on the
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

### 2. Add Chinese and Arabic keywords to the offline intake extractor

**Why.** In fixture mode (no API keys), typed requests that don't match a demo scenario go through a keyword
extractor. Its `CATEGORY_WORDS` cover English, Spanish, Vietnamese and Haitian Creole only, so a Chinese or Arabic
request always files as `other`.

**Files.** `packages/agents/src/intake/heuristic.ts`, tests in `packages/agents/src/intake/intake-agent.test.ts` or a
new `heuristic.test.ts`.

**Done when.** A Chinese request about 停电 (power outage) and an Arabic request about طعام (food) map to
`utility_outage` and `groceries`, and the extractor still never sets `requestedAmountCents`. Note: `wordsRe` uses
letter boundaries, which do not exist between CJK characters, so check how matching behaves for Chinese.

**Labels.** `agents`, `i18n`, `good first issue`

---

### 3. Prompt-injection review patterns for Korean, Russian and Tagalog

**Why.** `packages/core/src/injection.ts` has patterns for English, Spanish, French, Vietnamese, Haitian Creole,
Chinese and Arabic. The other languages in `LANGS` have none, so "ignore the rules" in Korean does not raise the
organizer-facing `PROMPT_INJECTION` review flag.

**Files.** `packages/core/src/injection.ts`, `packages/core/src/injection.test.ts`.

**Done when.** Each new language has at least one `ignore_instructions` and one `role_override` pattern, each with a
positive test **and** a test that an ordinary polite request in that language does not match. The flag stays
`review`, never `block`.

**Labels.** `core`, `security`, `good first issue`

---

### 4. Upgrade vitest to clear the critical dev-dependency advisories

**Why.** `pnpm audit` reports critical advisories for `vitest` < 3.2.6 and its `tinypool`, and a high one for `vite`
(THREAT_MODEL.md, R5). They are dev-only, but they keep the CI audit job red.

**Files.** Root `package.json` (`vitest`), `packages/core/package.json` and `packages/db/package.json`
(`@vitest/coverage-v8`), `pnpm-lock.yaml`, and any `vitest.config.ts` that needs changes.

**Done when.** `pnpm test` passes in every package, `pnpm --filter @neighborline/core coverage` still works, and
`pnpm audit --audit-level=high` no longer lists `vitest`, `tinypool` or `vite`.

**Labels.** `dependencies`, `ci`, `good first issue`

---

### 5. Add ESLint to `packages/core`

**Why.** The root `package.json` has a `lint` script (`pnpm -r --if-present lint`) but no package defines `lint`,
so it does nothing. Start with the pure domain package.

**Files.** `packages/core/package.json` (a `lint` script), an `eslint.config.js` flat config using
`typescript-eslint`, and a CI step in `.github/workflows/ci.yml`.

**Done when.** `pnpm --filter @neighborline/core lint` passes with the recommended type-aware rules, plus a rule
banning floating-point money helpers is a bonus. CI runs `pnpm -r --if-present lint`.

**Labels.** `devex`, `good first issue`

---

### 6. Fix the `@neighborline/paypal` package metadata

**Why.** Before publishing to npm:
- `packages/paypal/package.json` → `repository.url` points to `github.com/neighborline/neighborline`, but the
  repository is `github.com/Aaaaarin/neighborline`.
- `packages/paypal/CHANGELOG.md` lists `ensurePlan`, but the method is `ensureMonthlyPlan`
  (`packages/paypal/src/subscriptions.ts`).

**Files.** The two above.

**Done when.** Both are corrected and `pnpm --filter @neighborline/paypal build` still succeeds. Bonus: add
`bugs` and `homepage` fields.

**Labels.** `paypal`, `docs`, `good first issue`

---

### 7. Rail check test: zero-width and bidi characters in a payout handle

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

### 8. Korean and Russian UI strings for the neighbor's phone

**Why.** `apps/web/lib/i18n.ts` has natively written UI strings (button labels, "Hold to talk", "Money arrived") in
English, Vietnamese, Spanish and Haitian Creole. Everything else falls back to English, even though the language
picker offers Korean and Russian.

**Files.** `apps/web/lib/i18n.ts`.

**Done when.** `ko` and `ru` entries exist for every key, reviewed by a native speaker; `/call` renders them when the
language is picked; `pnpm --filter @neighborline/web typecheck` and the e2e a11y test for `/call` pass.

**Labels.** `web`, `i18n`, `good first issue`
