# NOTES-web — `apps/web` (web/design lane)

- Integration seam: `apps/web/lib/server/services.ts` (`Services` interface). Full mapping to core/db/paypal/agents in `apps/web/INTEGRATION.md`.
- Design system: `apps/web/DESIGN.md`. Screenshots: `apps/web/screenshots/` (regenerate with `node apps/web/scripts/screenshots.mjs`).
- E2E: `pnpm --filter @neighborline/web test:e2e` (builds + serves on :3100; uses `PLAYWRIGHT_BROWSERS_PATH`).

## Requests to other lanes
- **root `.env.example`:** add `PAYPAL_PLAN_ID=` (and optionally `PAYPAL_PLAN_ID_10/_25/_50`) for monthly donor buttons.
- **core/db:** Mrs. Lan's Venmo is `@lan-nguyen54` in web + agents fixtures; the db seed note says `@lan-nguyen`. Please align on `@lan-nguyen54`.
- **core:** the web mock uses category key `medicine`; core uses `medicine_copay`. Real wiring will use core's — no action unless you'd rather rename.
- **all packages:** web resolves NodeNext `./x.js` → `./x.ts` via webpack `extensionAlias`; keep that style or plain extensionless imports, both work.
- **agents:** the offline extractor (`intake/heuristic.ts`) marks an untranslated `summaryEn` with the text prefix
  `(offline mode, not translated)`. The web strips it and shows a separate hint (`apps/web/lib/untranslated.ts`). A
  structured flag on the extraction (e.g. `summaryEnTranslated: false`) would be cleaner than matching a prefix.
- **core / paypal / fake-paypal (done here, Oct 16, for JUDGE-PANEL-2 #10, small and mirrored):** batch states
  `FAILED_RAIL` and `MANUAL` added to `core.PayoutBatch.status` and `paypal.BATCH_STATUSES` (local states, never
  returned by `mapBatchStatus`; CHANGELOG entry); `/__fake/faults` accepts an error `name`. Review when convenient.
- **totals:** every money figure on /report, /donate and /ledger comes from `engine/totals.ts` (`loadFund`: one query,
  one 30-day window). Add new figures there, and to `test/consistency.test.ts`.
