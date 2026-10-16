# Neighborline — working agreement for agents

Read `SPEC.md` first. It is the source of truth for product, architecture and interfaces.

## Conventions
- TypeScript everywhere, ESM, strict mode. Package manager: **pnpm** workspaces. Node 22.
- Packages are named `@neighborline/<dir>` and export from `src/index.ts`. Use `"main": "src/index.ts"` +
  `"types": "src/index.ts"` for internal packages (Next.js transpiles them via `transpilePackages`);
  `packages/paypal` additionally builds to `dist/` with `tsup` for npm publishing.
- Tests: **vitest**, colocated as `*.test.ts`. Every package has `test` and `typecheck` scripts.
- No secrets in code or git. Read config from env (see `.env.example`). `pnpm dev` must work with zero
  credentials (`PAYPAL_MODE=fake`, `AI_MODE=fixture`).
- Money is integer **cents** internally (`amountCents: number`); format to "150.00" strings only at the
  PayPal boundary. Never floats for money.
- `packages/core` has **no I/O** (pure functions, zod schemas, types).
- AI never computes amounts or decides eligibility. Code does. See SPEC §2.
- Keep files focused (<400 lines). Prefer small pure functions with tests.
- Commit messages: imperative, scoped, e.g. `core: add lookalike handle detection`.

## Ownership (parallel agents — stay in your lane)
- `packages/core` + `packages/db` — domain/data agent
- `packages/paypal` + `tools/fake-paypal` — payments agent
- `packages/agents` — AI agent
- `apps/web` — web/design agent
If you need a change in another package, write it in `NOTES-<yourlane>.md` at repo root instead of editing it.

## Commands
- `pnpm install` · `pnpm test` · `pnpm typecheck` · `pnpm dev` · `pnpm fake-paypal`
