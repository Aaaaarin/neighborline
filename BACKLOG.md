# Neighborline backlog (lead-maintained)

Ordered by impact on judging. ✅ done · 🔄 in progress · ⏳ blocked on human · ☐ todo

Status as of Oct 17, 2026: 1103 unit tests (`pnpm test`, 11 packages), 18 workflows node tests and 38 Playwright
tests pass on `main`; typecheck and the production web build are green.

## Blocked on human
- ⏳ **Key day: one checklist, [docs/GOLIVE.md](docs/GOLIVE.md).** About 10 minutes of clicks (two PayPal sandbox
  apps, the sandbox Personal account that also stands in on the hosted `/demo`, an OpenAI key, a Render account,
  API key and the Blueprint click), then `pnpm golive` runs the sandbox spike, live AI, the Render deploy with a
  hosted `/demo` run, the voiceover and the doc finalization. Everything in Wave 4 below waits on it
- ⏳ Permission to make the repo public; Devpost submission; public YouTube upload (GOLIVE.md "Then")
- ⏳ Optional: a native speaker to review the vi / es / ht copy and the video's Vietnamese (review packet in
  `docs/submission/review/`); npm org + token for `@neighborline/paypal`; a Twilio number for the hotline

## Sandbox `/demo` stand-ins and key-day automation ✅
- ✅ `SANDBOX_DEMO_RECEIVER_EMAIL` (sandbox + `DEMO_MODE` only, `req_demo_*` only): Lan/Jean/Walter's payouts go to a
  PayPal sandbox account standing in for their Venmo/email after the rail checks on the scripted destination, so they
  really settle; Rosa's run uses a fresh unregistered address and genuinely goes `UNCLAIMED` (stage offers cancel, no
  faked claim); audited (`demo.sandbox_stand_in`); stage, both phones, organizer card, rail steps and `/trust` say
  so; demo runs stay exempt from caps, budget and duplicate-destination checks. Tests run the engine in
  `PAYPAL_MODE=sandbox` against the fake (`apps/web/test/sandbox-standin.test.ts`). NOTES-golive request done
- ✅ `pnpm golive`: preflight → sandbox-setup → sandbox-spike → live-ai → deploy-render → video-vo → finalize-docs,
  idempotent and resumable, tested against the fake PayPal, a mock Render API and a mock hosted app; `deploy-render`
  sets the stand-in (default `SANDBOX_PERSONAL_EMAIL`) and defaults the hosted mode to sandbox when a receiver exists;
  `finalize-docs` writes the README rows and DEVPOST sentences only from a real sandbox run; `pnpm check-links`
- ✅ fake-paypal: webhook subscriptions (CRUD, event types, event list, resend); duplicate `sender_batch_id` error
  bodies pinned as fixtures the client must resolve

## Public-deployment hardening ✅
- ✅ R9: rate limits and the phone line's per-caller limits in shared Postgres buckets (atomic token-bucket UPSERT)
- ✅ Pluggable human check on model-using intake (Turnstile when configured, else a background proof of work bound to
  the visitor, single use; `/demo` never asks); e2e with `HUMAN_CHECK=pow`
- ✅ R12: the organizer queue is organizers-only unless `DEMO_MODE` or `PUBLIC_QUEUE=on`; anonymous stream caps key on
  the client IP

## Language and copy ✅
- ✅ Vietnamese address forms (bà, ông, chị… → chúng cháu / chúng tôi) and fr/tl/ko/ru catalogs; status, decline,
  appeal and phone copy in all ten languages with the Vietnamese register; the English line under a thread message is
  the same catalog key and slots; Spanish requester copy assumes no gender
- ✅ Review packet regenerated with a Status column (machine-assisted, pending native review)

## Video and submission ✅
- ✅ Draft 4 (2:40.5) cut from re-recorded takes (Lan in the bà register, matching EN lines, stopwatch 0:22.5, the
  1093-test code card; a fresh run now reads 1103, so the card stays as recorded unless the video is re-cut);
  thumbnail stopwatch fits the 3:2 card; stage, home, call and rules screenshots re-taken
- ✅ Paste-ready Devpost packet, gallery, hero GIF (`docs/submission/`); test counts refreshed everywhere (README badges
  and Testing, STATUS, DEVPOST, DEVPOST_FIELDS, CHECKLIST, INTEGRATION, VIDEO_SCRIPT)
- ✅ Rules editor: no false "You've edited the rules since this draft" right after Draft policy

## Wave 3: close honesty gaps ✅
- ✅ Approval service as a **separate process** (`apps/approver`): the only process with Payouts credentials; the web
  app calls it over HMAC-signed requests; it re-verifies policy, rail, approval hash and signatures itself
- ✅ Organizer authentication: sessions, **passkey (WebAuthn) signatures over the approval hash**, labelled demo keys
- ✅ Audio deleted after transcription (configurable retention), PII redaction in logs and traces
- ✅ `/api/health` + signed `/api/internal/*` for Render Workflows (`workflows/src/contract.ts`)
- ✅ Dependency audit: vitest 4 / vite 7 / overrides; prod audit blocks CI on high and critical
- ✅ Arabic RTL in the requester UI; k-anonymity threshold 5 in the report
- ✅ Report demo data consistent with the seed; demo data labelled
- ✅ One honest speed framing everywhere (system time vs. people's decision time)
- ✅ `@neighborline/paypal` metadata (repo URL, CHANGELOG method names)

## Wave 4b: product depth ✅
- ✅ Rules editor: plain English → AI draft (a quote per cap) + code diff + queue preview → two signatures over the
  draft hash activate; waiting requests re-priced
- ✅ Alerts UI (organizer, ledger), Arabic message templates, passkey revocation, `seedDemoQueue` in one transaction
- ✅ Red-team QA pass on a local production build ([QA-REPORT-1](docs/qa/QA-REPORT-1.md))
- ✅ Draft 1 video via the automated pipeline (fixture mode, captions, no voiceover): `docs/submission/video/`

## QA report 1 fixes ✅
- ✅ P0-1 claims: README, DEMO, PAYPAL, SPEC, SECURITY, INTEGRATION, DEVPOST and the submission docs match the code
  (no in-memory-engine claims, real test counts, measured 22 s run / 3 s system, every DEVPOST [VERIFY] resolved)
- ✅ P1-1 / P1-2 / P2-5 / P2-6 `/call`: one clarifying question with quick answers in ten languages, voice or text
  replies, translated errors and a 2,000-character counter, survives refresh, typed text never labelled a recording
- ✅ P1-3 / P2-9 / P2-10 isolation and browser hardening: per-visitor demo sessions, reset needs the internal HMAC
  (stages offer a replay), same-origin JSON-only writes, nonce CSP with `strict-dynamic`, HSTS, `frame-ancestors`
- ✅ P1-4 redacted public reads and scoped streams; /trust privacy copy rewritten (NOTES-trust §2)
- ✅ P1-5 REVIEW appeal goes to a different organizer; decline is idempotent; no phantom note
- ✅ P1-6 `DEMO_MODE` fails closed (refused with live PayPal); signatures always required
  (`NEIGHBORLINE_REQUIRE_PASSKEYS` removed); visitors sign only as Marcus on their own runs; /trust "In this demo"
  generated from config
- ✅ P2-1 concurrent taps all return 200 with one batch
- ✅ P2-2 / P2-3 injection heuristics for ru, ko, tl, leetspeak and notes to the AI; excerpts cut at word boundaries
- ✅ P2-7 at-least-once webhooks; P2-8 `UNKNOWN` on ambiguous PayPal errors with a policy re-check before re-send;
  P2-11 approval id in `sender_batch_id`; P2-12 nonce-bound WebAuthn challenges; P2-14 reconcile detects status
  drift, currency and stuck `PENDING`, persists every run, ledger shows the reason
- ✅ P2-15 / P2-16 focus management; axe at phone width
- ✅ P2-17 offline extractor reads zh, ar, ko, ru, fr, tl
- ✅ P3: phone clocks follow the story clock, chips wrap on phones, Rosa's claim wait counts as the neighbor's time,
  landing CTAs go to `/call` and autoplay, the `/call` placeholder is translated in all ten languages
- ✅ CI: `ci.yml` was invalid YAML since 14:05 (unquoted `: ` in a step name), so no job ran; fixed

## Still open (no human needed)
- ✅ Re-record the video takes with the current build and re-cut (Draft 4); VO renders with `pnpm golive` (video-vo)
- ✅ Shared rate-limit store and bot protection before any real deployment (R9)
- ✅ Video lane: Draft 3 rendered with the re-recorded MCP take (Dana, Marcus, `@lan-nguyen54`; 14.6 s) and the
  972-test code card (test run re-cached in `edl.json`) → `$VIDEO_OUT/neighborline-draft3.mp4`
- ✅ Test counts refreshed in README (badges + Testing), DEVPOST, INTEGRATION, VIDEO_SCRIPT and STATUS: `pnpm test`
  **972** (core 356, web 168), `playwright test --list` **34** (after the QA-2 P2-3/P3 fixes)
- ☐ QA-2 P3 (deliberate, left as is): reconcile rate limit is per IP (4 a minute)

## QA report 2: last P2 and the P3s ✅ ([QA-REPORT-2](docs/qa/QA-REPORT-2.md))
- ✅ P2-3 a batch PayPal refuses at the account level stops the `/demo` stage honestly: core `payout.rail_refused`
  StageEvent (once per refused batch, emitted by the engine with the organizer alert); the stopwatch stops in the
  alarm color ("Stopped · PayPal refused the payout") with "PayPal refused this payout: the sponsor's account needs
  attention. No money moved. Organizers were alerted; they can record a hand-over instead."; the rail ends at
  "Organizers alerted" / "<name> told in <language>"; both organizer phones say the same instead of "Sending…"; the
  neighbor gets a neutral note in their language (core `railRefusedNotice`, all 10 languages; message key
  `payout_rail_refused`). Tests: core, engine (`test/rail.test.ts`), stage steps, and an e2e that injects
  `SENDER_RESTRICTED` on the fake (`e2e/rail.spec.ts`, its own Playwright project, run last)
- ✅ P3 the rules title's "(vN)" follows the version a draft becomes (core `stampPolicyVersion`); a draft that only
  differs in that marker is still "nothing changed"
- ✅ P3 text-face preloads are per page (`/`, `/report`; `lib/fonts.ts`), none on `/organizer` (e2e checks no
  unused-preload warning)
- ✅ P3 default passkey labels name the browser ("Priya's Mac · Chrome") and an organizer's repeats are numbered
  server-side ("… 2"), so "Devices that can sign" never shows identical rows

## Eval findings, invite codes, neighbor-language payouts ✅
- ✅ EVAL findings 1–7 fixed with tests and measured dev vs held-out (docs/EVAL.md): phones grounded as E.164, French
  "point", CJK amounts, no fallback to a different destination; per-language spoken symbols (zh/ko/ru) and fillers (tl);
  homoglyphs latinized before stripping; injection rules for role-play, notes to the AI, short base64, authority claims;
  amount mentions flag only when a payment verb orders them; categories scored by need words; CI bars one case below
- ✅ `cancel-item` needs an organizer session (or the visitor's own demo run in DEMO_MODE); the approver re-checks (T42)
- ✅ Single-use, expiring invite codes stored as SHA-256 (`organizer-invite <id> [--ttl 72h]`; THREAT_MODEL R13 mitigated)
- ✅ Venmo/PayPal note and payout email subject in the neighbor's language (core `payoutCopy`, PayPal length limits);
  the organizer's decline note translated with a back-translation check, or sent as written with a line in their
  language

## Judge panel 2: consistency and fallback rail ✅
- ✅ #3 one fiscal sponsor name (db seed); the seeded month has one genuinely unclaimed 25-day-old payout, so the day-25
  alert, the ledger row and the Unclaimed total agree; /report, /donate and /ledger compute every total from one query
  and one 30-day window with the same labels (Donations in, Landed with neighbors), pinned by `test/consistency.test.ts`;
  /call shows no "Sending the money" step on a declined request; offline mode's untranslated marker is a hint beside
  the neighbor's words, never inside them; home bubbles follow the story clock
- ✅ #10 payout rail adapter: PayPal Payouts primary; account-level refusals → `FAILED_RAIL` + organizer alert; a
  manual fallback (group setting, off by default) records cash/check hand-overs with the same two passkey
  signatures plus a receipt note and never moves money (THREAT_MODEL T36, R16)
- ✅ QA P3: autoplay reload starts no second run (e2e); /report CLS 0 (fonts preloaded); no unsigned reset in the
  screenshot and video scripts; screenshots re-taken

## QA report 2 fixes ✅ ([QA-REPORT-2](docs/qa/QA-REPORT-2.md))
- ✅ P1-1 a request a judge sends from `/call` can be paid: after the visitor approves it as Marcus, Dana's scripted
  demo key signs second (DEMO_MODE only, own `/call` requests only, never after an appeal); `/call` footer, `/trust`
  disclosure and DEVPOST step 5 say so
- ✅ P2 `/report` narrative uses the page's window label (group time zone), not UTC dates
- ✅ P2 `/trust` says Marcus's demo key can be the second signature on a rules draft (never the only one)
- ✅ P2 README, DEVPOST, INTEGRATION and VIDEO_SCRIPT test counts match `pnpm test` (953) and `--list` (32)
- ✅ P2 MCP example uses the main story's cast (Dana, Marcus, `@lan-nguyen54`); terminal take re-recorded
- ✅ P2 `next build`/`next dev` with a custom `NEXT_DIST_DIR` leave the tree clean (generated, git-ignored tsconfig via
  `typescript.tsconfigPath`; `next-env.d.ts` git-ignored, `next-types.d.ts` tracked)
- ✅ P2 offline extractor reads a Kreyòl household ("Nou 3 nan kay la")

## Wave 4: real world (scripted by `pnpm golive`; ⏳ the keys in [GOLIVE.md](docs/GOLIVE.md))
- ☐ Real sandbox spike: Payouts PayPal + Venmo, webhooks, Transaction Search, Orders/Subscriptions buttons
  ([checklist](docs/PAYPAL.md#to-verify-in-the-real-sandbox)) → `sandbox-setup`, `sandbox-spike`
- ☐ Live AI: eval live columns, demo audio with TTS, three real intakes → `live-ai`
- ☐ Deploy to Render with the Blueprint (web + approver, Postgres, Workflows, scheduler); `verify-deploy.sh`; a hosted
  `/demo` run that settles in the sandbox through the stand-in → `deploy-render`
- ☐ Optional phone/WhatsApp channel via Twilio ⏳ account

## Wave 5: win the room
- ☐ Red-team QA pass (bugs, UX, copy) on the hosted build
- ☐ Video: voiceover (`video-vo`) → native-speaker check → public YouTube upload
- ☐ Devpost: `finalize-docs` fills `{HOSTED_URL}`, `{VIDEO_ID}`, sandbox buyer; thumbnail and gallery are ready
- ☐ Sponsor prize: APIMatic Context Plugin (Payouts + Transaction Search): decide
