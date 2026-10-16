# Neighborline backlog (lead-maintained)

Ordered by impact on judging. ✅ done · 🔄 in progress · ⏳ blocked on human · ☐ todo

## Blocked on human
- ⏳ PayPal sandbox client id/secret (+ Payouts enabled) → real sandbox spike, webhook registration
- ⏳ OpenAI API key (STT/TTS/LLM) → live AI hero take; Anthropic key optional
- ⏳ Render account → hosting (render.yaml ready)
- ⏳ Permission to make repo public; Devpost submission; YouTube upload
- ⏳ Optional: Twilio account (voice line / WhatsApp sandbox) — "hotline" channel
- ⏳ Native-speaker check of vi / es / ht copy (nice to have)

## Wave 3 — close honesty gaps (claims on /trust must be true)
- ✅ Approval service as a **separate process** (`apps/approver`): only process holding Payouts creds; web calls it with HMAC-signed requests carrying the two-person approval record; it re-verifies policy/rail/approval hash itself
- ✅ Organizer authentication: per-organizer sessions; **passkey (WebAuthn) signatures bound into the approval hash**; demo mode issues demo sessions so judges can act as Marcus
- ✅ Audio deleted after transcription (configurable retention), PII redaction in logs/traces
- ✅ `/api/health` + `/api/internal/*` endpoints for Render Workflows (contract in workflows/src/contract.ts)
- ✅ Dependency audit: upgrade vitest/next/etc., isolate agent-toolkit advisories; make audit job blocking for high+ in our direct deps
- ✅ Arabic RTL in requester UI; k-anonymity threshold 5 in report
- ✅ Report demo data consistent with seed (donor counts, payout counts); label demo data
- ✅ One honest speed framing everywhere (machine time vs. human decision time)
- ✅ paypal package metadata (repo URL, CHANGELOG method names)

## Wave 4 — real world
- ☐ Real sandbox spike: Payouts PayPal + Venmo, webhooks, Transaction Search, Orders/Subscriptions buttons
- ☐ Live AI: generate demo audio with TTS; real STT on recorded voice; latency budget
- ☐ Deploy to Render; smoke test; keep-warm
- ☐ Optional phone/WhatsApp channel via Twilio

## Wave 4b — product depth (unblocked)
- 🔄 Rules editor: plain-English policy → AI-compiled draft + diff → two passkey approvals to activate
- 🔄 Alerts UI (organizer/ledger), Arabic decline template, passkey revocation
- 🔄 Red-team QA pass on local build
- 🔄 Draft video via automated pipeline (fixture mode, captions, no voiceover yet)

## Wave 5 — win the room
- ☐ Red-team QA pass (bugs, UX, copy) on hosted build
- ☐ Video: automated recording pipeline → cut → captions → voiceover
- ☐ Devpost write-up final, thumbnail, gallery
- ☐ Sponsor prize: APIMatic Context Plugin (Payouts + Transaction Search) — decide
