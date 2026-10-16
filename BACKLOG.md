# Neighborline backlog (lead-maintained)

Ordered by impact on judging. ✅ done · 🔄 in progress · ⏳ blocked on human · ☐ todo

Status as of Oct 16, 2026 (late evening): 795 unit tests (`pnpm test`, plus the workflows' node tests) and 31
Playwright tests pass on `main`.

## Blocked on human
- ⏳ PayPal sandbox client id/secret for the main app **and** a separate Payouts app (Payouts enabled) → real sandbox
  spike, webhook registration on both apps
- ⏳ OpenAI API key (STT/TTS/LLM, and the video voiceover) → live AI take; Anthropic key optional
- ⏳ Render account (payment method or hackathon credit) → hosting (`render.yaml` ready)
- ⏳ Decide the hosted PayPal mode: `render.yaml` says `PAYPAL_MODE=sandbox`, but Rosa's claim only plays in fake
  mode and the sandbox spike hasn't run. Fake mode, honestly labelled, matches every screenshot and the video
- ⏳ Permission to make the repo public; Devpost submission; public YouTube upload
- ⏳ A native speaker to review the vi / es / ht copy and the video's Vietnamese voice and translations
  (ko / ru / zh / ar UI strings too, if possible)
- ⏳ Optional: Twilio account (voice line / WhatsApp sandbox) for the "hotline" channel

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
- ☐ Re-record the video takes with the current build (Lan now freezes at about 0:22.5) and re-cut Draft 1; then VO
  once the OpenAI key arrives
- ☐ Shared rate-limit store and bot protection before any real deployment (R9)
- ☐ Stop `next build` with a custom `NEXT_DIST_DIR` from rewriting `apps/web/next-env.d.ts` and `tsconfig.json` (QA P3)

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

## Wave 4: real world
- ☐ Real sandbox spike: Payouts PayPal + Venmo, webhooks, Transaction Search, Orders/Subscriptions buttons
  ([checklist](docs/PAYPAL.md#to-verify-in-the-real-sandbox)) ⏳ credentials
- ☐ Live AI: demo audio with TTS, real STT on a recorded voice note, latency budget ⏳ OpenAI key
- ☐ Deploy to Render with the Blueprint (web + approver, Postgres, Workflows, scheduler); smoke test
  (`scripts/verify-deploy.sh`); keep warm ⏳ Render account
- ☐ Optional phone/WhatsApp channel via Twilio ⏳ account

## Wave 5: win the room
- ☐ Red-team QA pass (bugs, UX, copy) on the hosted build
- ☐ Video: re-record → cut → captions → voiceover → native-speaker check → public YouTube upload
- ☐ Devpost: fill `{HOSTED_URL}`, `{VIDEO_ID}`, sandbox buyer; thumbnail and gallery (THUMBNAIL_BRIEF.md)
- ☐ Sponsor prize: APIMatic Context Plugin (Payouts + Transaction Search): decide
