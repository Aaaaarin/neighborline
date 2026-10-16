# Contributing to Neighborline

Thank you for helping. Neighborline moves real money to people in hard moments, so we care about two things more
than anything else: **every amount is computed by code**, and **every claim we make is true of the code**. Small,
well-tested pull requests are the best kind.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go to [SECURITY.md](SECURITY.md), not to
public issues.

## Setup

You need Node 22 (anything ≥ 20 works) and pnpm 10 (the exact version is pinned in `package.json`).

```bash
corepack enable
pnpm install
pnpm dev                 # http://localhost:3000, no credentials needed
```

`pnpm dev` runs with `PAYPAL_MODE=fake` and `AI_MODE=fixture`, so you never need PayPal or model keys to
contribute. Copy `.env.example` to `.env` only if you want to try the real sandbox or live models. Never commit
`.env`.

| Command | What it does |
|---|---|
| `pnpm test` | All unit tests (vitest), offline |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm --filter @neighborline/core test` | One package's tests (`core`, `db`, `agents`, `passkeys`, `paypal`, `approver`, `web`, `fake-paypal`, `dev-db`) |
| `pnpm --filter @neighborline/paypal build` | Build the publishable PayPal package |
| `pnpm --filter @neighborline/web test:e2e` | Playwright end-to-end tests (run `pnpm --filter @neighborline/web exec playwright install chromium` once) |
| `cd workflows && npm test` | The Render Workflows tasks (a standalone npm package, outside the pnpm workspace) |
| `pnpm fake-paypal` | Start the local PayPal look-alike on :4010 |
| `pnpm --filter @neighborline/db generate` | After a schema change: generate the SQL migration and re-embed it |

## Where things live

The repo is split into **lanes**. Each lane owns its directories. If your change needs something in another lane,
say so in the PR (or, for agents, in `NOTES-<lane>.md`) rather than reaching across.

| Lane | Directories | Rules of the road |
|---|---|---|
| Domain | `packages/core` | Pure functions only: no I/O, no `Date.now()` without an injectable `now`. The zod contract in `src/schemas.ts` is shared by everyone: changes must be additive |
| Data | `packages/db` | Every status change goes through the core state machine and the audit log. Never edit an applied migration |
| Payments | `packages/paypal`, `tools/fake-paypal` | Every PayPal fact needs a source in `PAYPAL_NOTES.md`. If the fake and the docs disagree, the docs win |
| AI | `packages/agents` | Every model output goes through `runStructured` (validate → repair → re-ask). Models never produce amounts |
| Web | `apps/web` | Routes are thin: parse, call `services()`, return JSON. Follow `apps/web/DESIGN.md` |
| Docs and DevEx | `README.md`, `docs/`, `.github/`, `*.md` at the root | Every claim must be true of the code; mark anything unbuilt as roadmap |

## Adding a language to the message catalog

Neighbors receive status messages from a **vetted** catalog, not from free model output. Adding a language means
writing those messages, ideally with a native speaker. Take Tagalog (`tl`) as the example:

1. **Core catalog.** In [`packages/core/src/i18n.ts`](packages/core/src/i18n.ts), add `'tl'` to `CATALOG_LANGS` and
   add a `tl` block to `CATALOG` with all nine `MESSAGE_KEYS`. Keep the slots exactly as in English (`{amount}`,
   `{wallet}`, `{name}`) and keep optional greetings inside `[[ ]]`. TypeScript will refuse to compile until every
   key is present.
2. **Intake phrases.** In [`packages/agents/src/intake/phrases.ts`](packages/agents/src/intake/phrases.ts), add a
   `tl` block to `EXTRA` (`payout_line`, `ask_category`, `ask_location`, `ask_again`). It is typed by
   `CatalogLang`, so the compiler will remind you.
3. **Tests.** [`packages/core/src/i18n.test.ts`](packages/core/src/i18n.test.ts) already loops over
   `CATALOG_LANGS`: it checks every key exists, the slots match English, and paid messages contain the amount.
   Run `pnpm --filter @neighborline/core test`. Then run the agents tests, since catalog languages stop going through
   LLM translation: `pnpm --filter @neighborline/agents test`.
4. **Optional, for the neighbor's UI.** Add natively written strings to
   [`apps/web/lib/i18n.ts`](apps/web/lib/i18n.ts) (others fall back to English). Language names are already in
   [`apps/web/lib/format.ts`](apps/web/lib/format.ts).
5. **Optional, for prompt-injection review flags.** Add patterns for the language to
   [`packages/core/src/injection.ts`](packages/core/src/injection.ts), with tests that polite pleas in that language
   do **not** match.
6. In the PR, say who reviewed the wording and in which register (formal or informal).

A language outside `LANGS` in [`packages/core/src/schemas.ts`](packages/core/src/schemas.ts) also needs adding
there; that is a contract change, so open an issue first.

Tone guide: plain, warm, short; the neighbor is "you"; never "applicant" or "beneficiary"; declines say "this is
not a judgment about you" and offer a person to talk to. See [`apps/web/DESIGN.md`](apps/web/DESIGN.md#voice--tone).

## Adding a rail check

Rail checks protect **where money goes**. They never score a person.

1. **Decide the severity.** `block` is only for destination safety: the money would go somewhere it must not
   (impersonation, self-payment, an exhausted cap). Everything else is `review`: the organizer sees it and decides.
2. **Add the code.** New codes go in `RailFlagCode` in
   [`packages/core/src/schemas.ts`](packages/core/src/schemas.ts). That is a shared-contract change; mention it in the
   PR so the web and db lanes can display and store it.
3. **Write a pure function** in [`packages/core/src/rail.ts`](packages/core/src/rail.ts) (or a new file it imports)
   that takes the destination, history, policy and text and returns `RailFlag[]`. The `detail` string is shown to
   organizers: say what was seen and what to do ("confirm the destination with the neighbor"), not what the person
   might be.
4. **Call it from `checkRail`**, which sorts block flags first.
5. **Test both directions** in [`packages/core/src/rail.test.ts`](packages/core/src/rail.test.ts): cases that must
   flag, and ordinary cases that must **not** flag (shared family accounts, names in a different order, accents).
   False positives cost a neighbor their aid.
6. **Show it.** Add a label for the code in [`apps/web/components/RailChips.tsx`](apps/web/components/RailChips.tsx).

## Commits and pull requests

- Commit messages are imperative and scoped by package: `core: add lookalike handle detection`,
  `paypal: resolve duplicate sender_batch_id via HATEOAS link`, `docs: explain approval hash`.
- One logical change per PR. Include tests with behavior changes.
- `pnpm typecheck` and `pnpm test` must pass. CI also runs e2e, a dependency audit and a secret scan.
- Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md). It includes the review checklist for code written
  with AI help, which is how this project was built.
- Money is integer cents. Format to `"150.00"` only at the PayPal boundary.
- New environment variables go in `.env.example` with an empty value and a comment.
- New dependencies need a reason in the PR description.

## Good first issues

[docs/GOOD_FIRST_ISSUES.md](docs/GOOD_FIRST_ISSUES.md) lists scoped starter tasks with the files to touch and how
to know you are done.
