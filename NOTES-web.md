# NOTES-web — `apps/web` (web/design lane)

- Integration seam: `apps/web/lib/server/services.ts` (`Services` interface). Full mapping to core/db/paypal/agents in `apps/web/INTEGRATION.md`.
- Design system: `apps/web/DESIGN.md`. Screenshots: `apps/web/screenshots/` (regenerate with `node apps/web/scripts/screenshots.mjs`).
- E2E: `pnpm --filter @neighborline/web test:e2e` (builds + serves on :3100; uses `PLAYWRIGHT_BROWSERS_PATH`).

## Requests to other lanes
- **root `.env.example`:** add `PAYPAL_PLAN_ID=` (and optionally `PAYPAL_PLAN_ID_10/_25/_50`) for monthly donor buttons.
- **core/db:** Mrs. Lan's Venmo is `@lan-nguyen54` in web + agents fixtures; the db seed note says `@lan-nguyen`. Please align on `@lan-nguyen54`.
- **core:** the web mock uses category key `medicine`; core uses `medicine_copay`. Real wiring will use core's — no action unless you'd rather rename.
- **all packages:** web resolves NodeNext `./x.js` → `./x.ts` via webpack `extensionAlias`; keep that style or plain extensionless imports, both work.
