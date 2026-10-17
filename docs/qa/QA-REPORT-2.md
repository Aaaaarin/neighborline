# QA report 2: regression pass on a fresh production build

Date: Oct 17, 2026 (Oct 16 evening Pacific). Build: `main` from `3d74ba0` (Draft 2 video cut) plus the fixes listed
below. Tester: QA + fixer agent.

**Setup.** A production build (`next build` with `NEXT_DIST_DIR=.next-qa2`, then `next start`) on its own ports:
web :3320, fake PayPal :4321, approver :4322, dev-db :4323/:4324. `PAYPAL_MODE=fake`, `AI_MODE=fixture`,
`DEMO_MODE=true`, rate limits on. Playwright Chromium (`/opt/pw-browsers`) with axe-core (WCAG 2.0/2.1/2.2 A and AA
tags), a CDP virtual authenticator for passkeys, and the `organizer-invite` CLI for invite codes. After the fixes the
app was rebuilt and every changed path re-run on the new build. Screenshots: `docs/qa/shots2/` (JPEG, 3.8 MB).

**Limits.** Fixture AI and the local fake PayPal only (no sandbox credentials, no hosted URL). One machine, one IP.

Severity as in [QA report 1](QA-REPORT-1.md): **P0** blocks submission · **P1** a judge will probably hit it, or it
contradicts a headline claim · **P2** a careful judge or PayPal engineer will notice · **P3** polish.

## Summary

| | Found | Fixed | Open |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 1 | 1 | 0 |
| P2 | 7 | 7 | 0 (P2-3 fixed after the pass) |
| P3 | 4 | 3 | 1 (per-IP reconcile limit, deliberate) |

Every QA-1 fix still holds: per-visitor isolation, reset not public, JSON-only same-origin writes, nonce CSP, the
`/call` clarifying question and its refresh, the 2,000-character limit, decline idempotency and the REVIEW appeal,
autoplay running once, focus moving to Approve on "Your turn", axe clean at phone width.

---

## P1

### P1-1 · A request a judge sends from /call can never be paid · **fixed** (`8e323cc`)
**Repro.** `/call` → sample voice note (Español) → "Sí, correcto". The thread's footer says *"Trying the demo on your
own? Open the organizer queue and approve it as two organizers."* On `/organizer` the only key a visitor may use is
Marcus's (`assertPublicDemoKey`: "you can approve as Marcus only; Dana is played by the demo script"). Approve with it:
the card reads **1 of 2 approvals** and the neighbor's stepper stays on *Esperando a dos vecinos · 1/2* forever
(`shots2/organizer-1920-visitor-queue.jpg`). DEVPOST testing step 5 ("Be the neighbor") sends judges exactly here.

**Fix.** In `DEMO_MODE`, when a visitor's demo-key tap as Marcus is the first signature on requests *they* sent from
`/call` (`req_v_<their tag>_…`), the server signs second as Dana with her labelled demo key after a 4 s beat, exactly
as the `/demo` script does (`lib/server/engine/demo-second.ts`, called from `Engine.approve`). Never on the seeded
queue, `/demo` runs (the scenario script owns those), an appealed request (a different organizer must decide), a
passkey tap, or with `DEMO_MODE` off. The `/call` footer now says "approve it as Marcus. Dana's scripted demo key signs
second", and the `/trust` "In this demo" disclosure (and NOTES-trust) lists it. Tests: the predicate's ten cases, an engine test from intake to `SUCCESS` (`test/security.test.ts`) and a
Playwright test over HTTP (`e2e/demo.spec.ts`). Re-run on the new build: 2/2, batch sent, claim help in
Spanish (`shots2/organizer-1920-visitor-approved.jpg`, `shots2/call-1280-after-organizer.jpg`).

## P2

| # | Finding | Repro / evidence | Status |
|---|---|---|---|
| P2-1 | **/report contradicts its own header every evening (Pacific).** The page says "last 30 days · September 16 – October 16, 2026"; the narrative under it says "From 2026-09-17 to 2026-10-17" (UTC dates from `buildFacts`). JUDGE-PANEL-2 #3 promised "one window with the same labels". | `/report` after 5 pm PT | **Fixed** (`8c533b9`): `buildFacts` / `ReportWriter` take the page's `periodLabel`; the label's year is the group's too. Tests in agents and `test/consistency.test.ts` (no ISO date in the narrative, label quoted). `shots2/report-1920-period.jpg` |
| P2-2 | **/trust under-states what a visitor's key can sign.** The disclosure said a visitor's key signs "never the shared queue, a rules change or a sign-in", but `/api/policy/sign` accepts Marcus's demo key as the second signature on a rules draft (the e2e rules test does exactly that). It can never be the only one (the other must be a real passkey), so the security claim holds; the sentence did not. | `org.mjs`: Priya (passkey) + Marcus (demo key, another browser) → Policy v2 active (`shots2/rules-1280-v2-active.jpg`) | **Fixed** (`52710fa`): disclosure, NOTES-trust and README say it; test pins it |
| P2-3 | **The /demo stage hangs when PayPal refuses the batch at the account level.** With a `SENDER_RESTRICTED` fault on the fake, both approvals land, the rail shows "PayPal Payouts batch created (in progress)" and the stopwatch runs forever; no "Stopped", no message to the neighbor. The organizer alert and the manual fallback work (`shots2/organizer-1920-rail-refused.jpg`), but nothing reaches the stage because `StageEvent` has no batch-refused event. Judges can't trigger it in fake mode; a restricted sandbox account would. | `railstage.mjs`, `shots2/demo-1920-rail-refused.jpg` | **Fixed**: core `payout.rail_refused`; the clock stops in the alarm color, the rail ends at "Organizers alerted", both organizer phones and the neighbor (in their language) are told no money moved; e2e `e2e/rail.spec.ts` |
| P2-4 | **Stale test counts in the README.** Badges said 711 unit / 30 Playwright; the table's per-package numbers were older still. `pnpm test` gives **953** and `playwright test --list` **32** (31 before this pass's new test; DEVPOST and INTEGRATION.md said 30). | `pnpm test`, `--list` | **Fixed**: README badges and table, DEVPOST, INTEGRATION.md, VIDEO_SCRIPT code card |
| P2-5 | **The MCP example told a different story** (organizers Ana and Ben, handle `@lan-nguyen`) from `/demo` and the video (Dana, Marcus, `@lan-nguyen54`). | `examples/mcp-agent-demo` | **Fixed** (`d4eec49`): transcript, `--llm` approvers, sign CLI, README output from a real run, docs/MCP.md; tests pin the cast; terminal take re-recorded (14.6 s) |
| P2-6 | **`next build` with a custom `NEXT_DIST_DIR` dirtied the tree** (QA-1 P3, raised because every parallel agent and the e2e run hits it): Next rewrote the tracked `next-env.d.ts` and `tsconfig.json`, which blocks `git pull --rebase`. | any `NEXT_DIST_DIR=.next-x next build` | **Fixed** (`c078dae`): a generated, git-ignored `.next-tsconfig-<dir>.json` via `typescript.tsconfigPath`; `next-env.d.ts` git-ignored as Next recommends, with a tracked `next-types.d.ts`. Two builds in this pass left `git status` clean. Documented in `apps/web/INTEGRATION.md` |
| P2-7 | **Kreyòl household not read offline.** "Nou 3 nan kay la" (we are 3 at home) still got "Konbyen moun ki rete lakay ou?" in fixture mode. Haitian Creole is one of the three vetted languages. | `/call`, Kreyòl, typed (`shots2/call-390-ht-readback.jpg`) | **Fixed** (`5e5bb05`): pattern + tests; eval unchanged and thresholds met |

## P3

- **Rules text still says "(v1)" after v2 is active.** Line 1 of the plain-English rules is the seed's title, "rules
  for quick cash help (v1)", and it is never updated when a new version activates. **Fixed**: the marker follows the draft's version.
- **Font preload warnings on `/organizer`.** Chromium logs "preloaded using link preload but not used within a few
  seconds" for three fonts (the preload added for `/report` CLS is global). Console noise only. **Fixed**: preloads are per page (`/`, `/report`).
- **Reconcile rate limit is per IP (4 a minute).** Several judges behind one office IP pressing "Reconcile now" get
  "Too many requests from this device". Deliberate for live PayPal; generous enough for one judge.
- **Every passkey is labelled "Priya's device" unless renamed**, so an organizer with three passkeys sees three
  identical rows in "Devices that can sign" before revoking one. The enrollment form has a "Name this device" field;
  the default could include the browser and OS. **Fixed**: "Priya’s Mac · Chrome", repeats numbered ("… 2").

## What was run (all on the production build)

| Area | Result |
|---|---|
| Every page at 1920 and 390 (`/`, `/demo`, `/call`, `/organizer`, `/organizer/rules`, `/donate`, `/report`, `/trust`, `/ledger`) | 200, no horizontal overflow, **axe: 0 violations of any impact** (WCAG 2.0/2.1/2.2 A+AA), no console errors, loads 0.7–1.0 s (`shots2/page-*`) |
| `/demo` auto: Lan (real pace), Rosa, Jean, Walter, Impersonator | All stop. **Lan 0:22.5, of which neighbors deciding 0:19.1, system 0:03.3** (matches "about 22 s / about 3 s"). Impersonator blocked at 0:01.2. Rosa: UNCLAIMED → claim help in Spanish → SUCCESS. axe clean on each finished stage |
| `/demo` manual as Marcus | Focus moves to "Approve $150" on "Your turn". With a virtual authenticator: "Signed with passkey · Visitor's device (as Marcus)"; without: the labelled demo-key fallback. Both reach SUCCESS |
| `/demo` at 390 | Chips wrap (Impersonator visible), run completes, no overflow |
| `/call` | vi sample voice note filed (sample-transcript label shown, correctly); es typed with no payout → one question in Spanish → answered → filed; zh question survives a reload; ar quick answers, RTL; ht and tl read back in their language; decline with an English note → translated chrome + the note quoted, REVISAR → "Otra persona del grupo revisará…", stepper back to 0/2 |
| `/organizer` | Invite code from the CLI enrolls Priya; the same code again and a code used for another organizer are refused ("wrong, expired or already used"); a second device enrolled, then revoked from the first ("Revoked … It can no longer sign in, approve or sign rules"), and the revoked device is signed out |
| `/organizer/rules` | Draft (Baby supplies $80/$160, quoted line 7) → Priya signs with a passkey (1 of 2, still v1) → Marcus's demo key in another browser → "Policy v2 is now active"; `/organizer` says "Amounts come from Policy v2" |
| `/ledger` | Reconcile now (anonymous allowed in fake mode, rate-limited): 8 matched, 0 mismatched (simulated); seeded rows marked "Seed history". Rail refusal: manual fallback switched on by a signed-in organizer, `SENDER_RESTRICTED` injected, two signatures → 503 with the organizer-facing message, alert with the manual form, "Record manual payment" with a receipt note → request paid, ledger row "By hand · cash … Not a PayPal payment", axe clean |
| `/donate` | Simulated once ($50) and monthly ($25) buttons walk Orders/Subscriptions; `/report` donations rise by exactly those amounts |
| Two visitors in parallel | Lan and Rosa run side by side, each stage shows only its own run; each visitor gets 404 for the other's run and `/call` request, 403 approving the other's run; the other's `/call` text never appears on their `/organizer` |
| Console | No errors on any page outside deliberate refusals (403 for a reused invite code, 404 for another visitor's request, 429 from the reconcile limit) |

Scripts (scratchpad, not committed): page sweep with axe, scenario runner, `/call` languages and appeal, `/call` →
`/organizer`, enrollment/revoke/rules, ledger/manual rail, donate + isolation, stage on a refused batch.

## Gate after the fixes

`pnpm typecheck` clean · `pnpm test` **953** passed (core 348, agents 196, web 157, paypal 97, db 72, approver 42, fake-paypal 16, passkeys 14, MCP example 6, dev-db 5) · `next build` clean tree · Playwright **32**
passed (own ports, own dist dir).
