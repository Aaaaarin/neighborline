# Judge panel 2: scoring the build as it actually exists

**Date:** Oct 16, 2026 (evening). **Build:** `main` at `e5ccc51`. **Days left:** about 11 working days (deadline Nov 12, 12:00 PST).
**Panel (simulated):** Jo Franchetti, Eddie Jaoude and Marco Podien (PayPal DevRel), a PayPal Senior PM, a PayPal Eng
Manager, and a veteran Devpost grand-prize judge. The personas come from `research/judges_devrel.md`,
`research/judges_paypal_product.md` and `research/judges_veteran.md`. The competitive field comes from `research/competitors.md`.

**What we looked at:**
- `README.md`, `docs/submission/DEVPOST.md`, `VIDEO_SCRIPT.md`, `THREAT_MODEL.md`, `BACKLOG.md`, `docs/qa/QA-REPORT-1.md`
- 19 screenshots in `apps/web/screenshots/`: `/demo` for Lan, Rosa, Jean, Walter, blocked, idle and your-turn at 1920 px; Lan at 390 px; `/call` at 390 px for idle, question, appeal and Arabic; organizer at 1920 px and appeal at 390 px; rules draft; report; trust; ledger with alerts; donate; home
- Video Draft 1: `contact.png`, `f_000s`, `f_030s`, `f_120s` and `f_160s`
- Code: `apps/approver/src/approver.ts`, `packages/paypal/src/{payouts,webhooks}.ts`, `packages/core/src/approvals.ts`, `packages/agents/src/validate.ts`, `intake/intake-agent.ts` and `intake/heuristic.ts`
- The GitHub REST API, to check repo visibility

These are simulated opinions and probabilities based on judgment, not data.

---

## 0. The headline, in one paragraph

The product, its design and its engineering instincts are top-decile. Two separate processes, passkey-signed
two-person approval, a `sender_batch_id` derived from the approval, an `UNKNOWN` state for ambiguous PayPal errors,
raw-body webhook verification, an unclaimed-payout rescue in the neighbor's language, a rules editor that quotes a
sentence for every cap, and 711 + 30 tests would put it in the top 1-2 % of the field on craft.

**But the submission currently rests on three things no judge can verify:**
- **No real PayPal call has ever been made.** Everything runs against `tools/fake-paypal`, which we wrote ourselves.
- **No real model call has ever been made.** `AI_MODE=fixture` is used everywhere.
- **There is no hosted URL, and the repo is private.** The GitHub API returns `"visibility":"private"`.

As it stands, the entry is the best-built *simulation* in the field. Every high-leverage item below is about turning
simulation into evidence. **None of these items is a new feature.**

---

## 1. Per-persona scores

Assumption: the entry is submitted with a hosted URL and a public repo, but **otherwise as it is today**: fake
PayPal, fixture AI, and Draft-1-quality video recut with a voiceover. The "projected" row assumes top-10 items 1-6
land.

### Jo Franchetti (DevRel: LLM output validation and repair, local LLMs, supply chain)

| Tech | Design | Impact | Innov | Pres | Sum |
|---|---|---|---|---|---|
| 7 | 8 | 8 | 7 | 7 | **37** |

- **Tech 7.** `validate.ts` is exactly her talk: generate → zod → one repair call → re-ask the human, with a trace the UI renders. Grounding drops handles the neighbor never said. The score is held down because none of it has ever run against a real model, and the organizer card in fixture mode reads `(offline mode, not translated) Se fue la luz…` (`organizer-390-appeal.png`), which she will see if she types into `/call`.
- **Design 8.** Per-message `lang` attributes, RTL Arabic, a "listen again" chip and calm copy. It is the most respectful requester UI in the field.
- **Impact 8.** Language access for elders and immigrants is her kind of problem.
- **Innov 7.** The repair-to-re-ask loop, surfaced to the end user, is genuinely rare.
- **Pres 7.** It depends on the recut. Draft 1 has no voiceover.
- **Hardest question:** *"Every AI test runs against fixtures and fake Anthropic/OpenAI clients. Show me one real Vietnamese voice note through `gpt-4o-transcribe` where the repair loop actually fired. And these are voice notes from vulnerable, possibly undocumented people: why is there no local Whisper or local-LLM option?"*

### Eddie Jaoude (DevRel: open source, EddieHub, dual-provider resilience)

| Tech | Design | Impact | Innov | Pres | Sum |
|---|---|---|---|---|---|
| 7 | 8 | 9 | 7 | 7 | **38** |

- **Tech 7.** The repo is a model OSS repo: MIT license, CONTRIBUTING, GOOD_FIRST_ISSUES, CI badges, and a publishable `@neighborline/paypal` plus an MCP server. But the package isn't on npm, the repo is private, and there is no one-click deploy he can actually click.
- **Impact 9.** It is community-run mutual aid with real people, the video he would make himself.
- **Innov 7.**
- **Pres 7.**
- **Hardest question:** *"Could a mutual-aid group in my city run this next week without you? And SanctuaryDMV's Venmo was frozen for 6 days. What's the fallback rail when the sponsor's PayPal is under review? I only see PayPal."* There is no rail adapter interface. `core/rail.ts` is rail *protection*, not rail *abstraction*.

### Marco Podien (DevRel: end-to-end TypeScript, hype-skeptic)

| Tech | Design | Impact | Innov | Pres | Sum |
|---|---|---|---|---|---|
| 7 | 8 | 8 | 6 | 6 | **35** |

- **Tech 7.** One zod contract flows from the LLM to policy, Payouts, the webhook and the UI. He loves that, and the drift test between `core` and `paypal` state machines is a nice touch.
- **Innov 6.** The middle of the loop is "AI proposes, code decides, humans approve" again.
- **Pres 6.** The hero stopwatch reads 0:22.4, but 19.2 s of it is *scripted* waits, and the PayPal it stops on is our own stand-in. He will read that as theatre, however honestly it is labelled.
- **Hardest question:** *"Your stopwatch measures your own `setTimeout`s against a PayPal you wrote yourself. What in this demo has ever touched `api-m.sandbox.paypal.com`?"*

### PayPal Senior PM (Venmo unit KPIs, "who is the customer")

| Tech | Design | Impact | Innov | Pres | Sum |
|---|---|---|---|---|---|
| 7 | 8 | 8 | 7 | 8 | **38** |

- **Design 8.** `/trust` is the best answer to AUP and Payouts gating in the field: a fiscal-sponsor checklist, purpose `NON_GOODS_OR_SERVICES`, `social_feed_privacy: PRIVATE`, and "Live-mode reality". It is the panel he wanted.
- **Impact 8.** It is Halo-Award-brand-aligned. The score is capped by "no real group or sponsor has said yes".
- **Hardest question:** *"Who pays: the fiscal sponsor? Have you talked to one? And why wouldn't a group just use PayPal Giving Fund plus a Google Form? Show me Venmo new-user activation from the unclaimed rescue, not just a nice message."*
- **Will spot:** the donate page names **two different fiscal sponsors**. The right column says "Eastside Community Foundation" (from `packages/db/src/seed.ts`), while the fine print says "Cascadia Community Fund" (from `DonateForm.tsx:145,254` and `fixtures/group.ts:82`).

### PayPal Eng Manager (production realism, Payouts lifecycle)

| Tech | Design | Impact | Innov | Pres | Sum |
|---|---|---|---|---|---|
| 8 | 7 | 7 | 7 | 7 | **36** |

- **Tech 8.** This is the highest Tech score on the panel, because the approver re-derives everything from the DB, re-verifies WebAuthn assertions, re-runs `computeAmount`/`checkRail`, leaves timeouts `UNKNOWN`, re-sends with the same id, and applies webhooks at least once after their effects land. That is more correct than most production code he reviews.
- **Design 7.** The ledger contradicts itself (`ledger-1920-alerts.png`):
  - An alert says NL-ED25 has been "Unclaimed for 25 days", but the table shows NL-ED25 dated **Oct 15** and **Landed**.
  - The summary shows "Unclaimed $0".
  - "Landed $2,600" doesn't match the report's and donate page's "$3,880 sent".
- **Hardest question:** *"The approver single-flights in an in-process `Map` and shares the web instance on Render. With two instances, or a restart mid-call, walk me through the double-pay path. And have you ever seen a real `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` verify against PayPal's RSA certs? Your fake signs with HMAC."*

### Veteran Devpost grand-prize judge

| Tech | Design | Impact | Innov | Pres | Sum |
|---|---|---|---|---|---|
| 7 | 8 | 9 | 7 | 7 | **38** |

- **Impact 9.** The grandmother, the ice storm and "unclaimed, then rescued in Spanish" are the most memorable human beats in a field of ~1,000 dashboards.
- **Pres 7.** The draft's first frame (`f_000s.png`) is a grey idle phone that says "Press Play scenario and she leaves a voice note" next to a grey `0:00.0`. That is UI instructions, not a hook. The end card shows a literal red `HOSTED_URL`. The code card shows the old `senderBatchIdFor` (`approval.hash.slice(0,24)`; the code now hashes domain ‖ id ‖ hash) and "612 tests" (now 711). Phone clocks read 7:42 while bubbles read 11:41 AM.
- **Hardest question:** *"When I click Try it out, does it load in 3 seconds, and does anything real happen when I talk into it?"*

### Aggregate

| | Tech | Design | Impact | Innov | Pres | **Avg** |
|---|---|---|---|---|---|---|
| Franchetti | 7 | 8 | 8 | 7 | 7 | 7.4 |
| Jaoude | 7 | 8 | 9 | 7 | 7 | 7.6 |
| Podien | 7 | 8 | 8 | 6 | 6 | 7.0 |
| Sr PM | 7 | 8 | 8 | 7 | 8 | 7.6 |
| Eng Manager | 8 | 7 | 7 | 7 | 7 | 7.2 |
| Veteran | 7 | 8 | 9 | 7 | 7 | 7.6 |
| **Panel avg (today, hosted and public)** | **7.2** | **7.8** | **8.2** | **6.8** | **7.0** | **7.40** |
| **Projected (items 1-6 below land)** | 8.4 | 8.3 | 8.5 | 7.5 | 8.6 | **8.26** |

**How to read it:**
- **Impact is our moat.**
- **Tech is the tiebreaker, and it is where the simulation costs us most.** The *code* is a 9. The *evidence* is a 6.
- **Innovation is the weakest column**, because the middle of the loop is the field's cliché. The levers are the parts nobody else has: the requester side, the unclaimed rescue, the "hotline" made literally true, and the approval-gated Payouts MCP.

---

## 2. Probabilities (judgment, field of ~1,000-1,500)

| Outcome | Today's build, hosted and public, fake + fixture | If top-10 items 1-6 land | Notes |
|---|---|---|---|
| (a) Top-3 overall | **4-7 %** | **11-16 %** | The Grand Prize needs a "this is real" moment that Bursar, Upstream and Handback already have |
| (b) Any special prize (HM) | **12-18 %** | **26-34 %** | Most likely: **Most Impactful** (about 55 % of the HM mass), then **Best Demo Delivery** (~20 %), **Best Use of PayPal + AI** (~15 %), Agentic Commerce (~10 %, only with item 6) |
| (c) Any cash prize | **17-24 %** | **36-46 %** | The jump comes partly from an **APIMatic** slot (item 8, 3 × $1k, about 9 visible entries) |
| Stage-1 fail (no prize possible) | **20-35 %** if submitted with no real sandbox call; **~100 %** if the repo stays private | **< 3 %** | See §5 |

---

## 3. Honest comparison with the strongest competitors

| Competitor | Where they beat us today | Where we beat them | Net |
|---|---|---|---|
| **Bursar** (spend authority, 2,250+ tests, all sponsor tools) | Hosted, real sandbox, sponsor-prize stacking (AG Studio, Bryntum, Channel3, Render), 3× our test count | Human story, Impact, Design; they sit in the most saturated cluster (A, ~35 entries) | They win Tech and sponsors; we win Impact and Presentation if the video lands |
| **Upstream** (pays OSS maintainers via Payouts, npm package, Claude Code plugin) | **Published npm package, real Payouts + Agent Toolkit MCP, hosted.** That is the same "Payouts for agents" ecosystem story we claim, and *already shipped*. Eddie and Marco love it | Vulnerable users, multilingual, two-human approval token, unclaimed rescue | **The most direct threat to "Best Use of PayPal + AI".** Publish our package or lose that framing |
| **Handback** (deposit hold + Gemini photo compare, 520 tests, CI, 3 sponsors) | Hosted; vision AI that judges can *see* doing something; sponsor stacking | Impact, story, language access | Even on Tech; we win on Impact |
| **Provenant** (hijacked shopping agents, refund liability, 573 tests) | Agentic Commerce fit; hosted | Concreteness and human stakes | They take Agentic Commerce; we take Impactful |
| **AgentBaazar / ShopBridge** | Own **Best Use of Agentic Commerce** (merchant agent-readiness, WebMCP, one script tag) | Different prize bucket | **Don't contest Agentic Commerce head-on.** Reframe the MCP server cheaply (item 6) so it appears in that judge's pile without diluting the story |
| **CoTreasury** (group treasury) | Similar middle loop | Requester-side intake, voice, languages, unclaimed rescue, passkeys | If our first 60 s show organizer UI, we get filed next to them. The hero must stay on Lan's phone |
| **Amanah** (charity payouts with guardrails, IPFS) | Nothing material; it is a weak entry | Everything | Low threat |

**Bottom line:**
- Neighborline has the **best Impact and Design in the field**, a **top-5 codebase** and a **bottom-quartile evidence trail.**
- Every top competitor has a hosted URL and a real sandbox. We have neither *yet*.
- Close that gap and we are a credible Most Impactful favourite and a top-3 outside bet.

---

## 4. Ten highest-leverage changes, ranked by expected score gain per hour

Hours are wall-clock work for agents plus one human. Gains are panel-average points, with 0 = no change.

| # | Change | Hours | Expected gain | Why it ranks here |
|---|---|---|---|---|
| **1** | **Make the repo public and deploy to Render** (web + approver + Postgres, keep-warm ping, `scripts/verify-deploy.sh`). Fill `{HOSTED_URL}` everywhere, including the video end card | 3-5 | Removes a **certain DQ**, +0.3 Design, +0.3 Pres | Infinite gain per hour: without it there is no prize at all. Do it first, even before sandbox credentials, in fake mode if necessary |
| **2** | **Real PayPal sandbox spike, then make the hero real.** Two REST apps (main + Payouts). Run Lan as a **PayPal-wallet** payout if Venmo stays a `POSPYO003` mock; keep Venmo for Jean with an honest label. Register webhooks and see one real RSA-verified `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`. Hosted default `PAYPAL_MODE=sandbox` for Lan, Walter and blocked; keep fake mode only for Rosa's claim (labelled). Put a 3-second shot of the **PayPal developer dashboard's webhook event list** with the same batch id in the video | 4-8 (blocked on credentials, so get them **tomorrow**) | Removes the **Stage-1 "meaningfully uses the sandbox" risk**, +1.0 Tech (every persona), +0.5 Pres | Marco's, Himraj's and Karthik's sinker questions all evaporate. "Sandbox: simulated" becomes "Sandbox: real" on the rail |
| **3** | **Fix the five consistency bugs a careful judge will hit** (~2 h): (a) one fiscal-sponsor name (seed vs `DonateForm`/`fixtures/group.ts`); (b) the ledger alert for NL-ED25 "unclaimed 25 days" vs the row "Oct 15 · Landed" vs "Unclaimed $0"; (c) ledger "Landed $2,600" vs report/donate "$3,880" (explain the scope or unify); (d) the `/call` appeal stepper shows ✓ "Enviando el dinero" on a declined request; (e) the fixture organizer summary prefix `(offline mode, not translated)`: show "English summary unavailable offline" in UI chrome, not inside the neighbor's words. Then re-take `home-*` and the screenshots | 2-3 | +0.2 Design, avoids −0.5 from the PM and EM | The cheapest points on the board. These are exactly the "the demo data is fake" tells that undo the trust story |
| **4** | **Live AI on the hosted build, plus one real voice.** `AI_MODE=live` with `AI_FALLBACK=fixture`, a daily spend cap and the existing rate limits. Have a **native Vietnamese speaker record Lan's voice note** (real human audio, not TTS) and run it through `gpt-4o-transcribe` → Claude. Show the real trace on the card ("IntakeExtraction valid · gpt-4o-transcribe 1.4 s · claude-sonnet-5-5 0.9 s"). Make one take where the **repair loop actually fires** (a garbled handle → re-ask in Vietnamese) | 4-6 (needs the OpenAI key) | +0.6 Tech (Jo +1), +0.4 Innov, +0.3 Pres | Turns "AI never decides" from a claim about fixtures into a demonstrated pipeline. A judge typing Tagalog into `/call` gets a real answer instead of an offline echo |
| **5** | **Recut the video around evidence, not mock-ups.** (a) **The first 3 s are audio**: Lan's real voice, a waveform and burned-in subtitles. No "Press Play" UI text and no grey idle clock (start the take with the voice note already arriving). (b) Use the **manual take for approval 2**: a real finger on Touch ID and the real passkey sheet. This kills Marco's "your stopwatch times your own setTimeouts". (c) A **real sandbox ids** beat with the PayPal dashboard. (d) Fix the stale cards (612 → 711 tests, the new `senderBatchIdFor`, `HOSTED_URL`, 11:41 AM bubbles under a 7:42 clock). (e) Cut Jean and Walter, and trim `/report` to 8 s. (f) Voiceover, then a native-speaker check, then a **public** YouTube upload | 8-12 | +1.2 Pres, +0.3 Impact | Presentation is 20 % of the score and the gate to everything else. The current draft opens with the weakest frame in the product |
| **6** | **The agentic-commerce angle without diluting the story:** reframe and ship what we already have. **Publish `@neighborline/paypal` and `neighborline-payouts-mcp` to npm.** Record a 12-second beat: Claude Desktop is asked "pay Lan $150"; it calls `create_payout_batch`; the server **refuses with no approval token**; two organizers sign; then the same call with the token pays (sandbox batch id). Line: *"Agents can pay people, but only with two humans' signatures."* Add a README section titled "For agent builders". This is "agent-to-human payouts with human mandates", which no one in cluster A has framed around **Payouts** | 4-6 | +0.4 Innov, +0.3 Tech (Eddie, Marco), opens the Agentic Commerce and PayPal+AI HM piles | Upstream already owns "published Payouts tooling", so we must ship ours to stay in that conversation. It reuses tested code, adds no new product surface, and plays after 1:52 in the video |
| **7** | **Make "hotline" literally true: a real phone number.** Twilio inbound voice: `<Say>` a greeting in English, Spanish and Vietnamese, then `<Record>` → `/api/intake` audio → the read-back played back with `<Play>` of the TTS file, with yes/no via `<Gather>` speech or DTMF. Inbound voice needs no 10DLC (that applies to SMS), and an upgraded account (~$20) removes the trial preamble. Put the number on the Devpost page: **"Call +1 (xxx) xxx-xxxx and leave a voice note in any language."** The note shows up on the hosted organizer queue | 10-14 | +0.5 Innov, +0.4 Design, +0.4 Impact, and the **"unforgettable" moment** | Today a judge can see that the "hotline" is a web page. A judge who dials a number and hears the read-back in their language will remember this entry above 1,000 others. Do it only once items 1-5 are done |
| **8** | **APIMatic sponsor qualification.** Use the APIMatic Context Plugin while extending the Payouts and Transaction Search code (for example, building the `PaymentRail` adapter in item 10 with it), write it up in the README, and show it for 5 s in the video | 4-6 | No change to the score; about **+$250-400 expected value** (3 × $1k, about 9 visible entries) | The cheapest cash floor. Skip AG Grid (a dashboard is the anti-pattern) and Bryntum |
| **9** | **Publish a small eval with real numbers** (`docs/EVAL.md` and a `/trust` panel). Use 30-40 multilingual inputs: real recordings where possible, otherwise labelled TTS, plus 20 injection attempts, 20 lookalike and 20 legitimate handles. Report extraction accuracy per language, repair rate, re-ask rate, injection catch rate, and **lookalike false-positive rate**. Be candid where Haitian Creole is weak | 6-8 | +0.4 Tech (Jo, Marco +1), +0.2 Innov | It turns "711 tests" (now table stakes) into "we measured the AI". It needs item 4 first |
| **10** | **Answer the two remaining sinkers in writing.** (a) **Real-world validation:** get one quote or letter from an actual mutual-aid organizer or fiscal sponsor (even "we'd pilot this") and put it on Devpost and `/trust`. (b) **Eddie's fallback-rail question:** a 60-line `PaymentRail` interface in `packages/paypal` (PayPal Payouts today; "sponsor ACH/check, manual" as a second implementation that just records an instruction), plus one README paragraph on what happens when the sponsor's account is under review | 4-6 (plus async outreach) | +0.4 Impact (PM, Eddie), +0.2 Tech | It removes the last "who actually asked for this?" and "single-provider fragility" probes |

**Also do (free):**
- Run the Devpost name-clash check.
- Use THUMBNAIL_BRIEF's thumbnail, with **no UI screenshot**.
- Change the tagline lead from "A hotline, not a dashboard:" to **"Leave a voice note in any language. Two neighbors approve. Cash lands in PayPal or Venmo."** "Not a dashboard" is a contrast that only makes sense to people who've seen 30 dashboards. Keep it as the second line and in the VO.

**Cut:**
- Jean and Walter from the video; keep them in the app.
- Any AG Grid or Bryntum work.
- New languages.
- More test-count chasing. 711 is plenty, and Bursar has 2,250, so you can't win that race.
- The long `/report` scroll.

### Is there a better agentic-commerce feature? (considered, not recommended)

- **The agent buys in-kind items** (a space heater found via Channel3, bought with Orders v2 from a sandbox merchant, shipped to Lan):
  - It qualifies for **Channel3** ($1.5k, a single winner) and adds Agentic Commerce weight.
  - **Cost:** 14-20 h, plus a fake merchant, plus shipping realism.
  - **Risk:** it dilutes "cash in minutes" and contradicts the mutual-aid ethos the README quotes ("solidarity, not charity", meaning cash and dignity, not vouchers).
  - **Verdict:** only as a 10-second "What's next" mock if items 1-9 are done. Never in the hero.
- **Donor agents (agent → Neighborline):**
  - Expose a `get_open_needs` (aggregate, k-anonymous) and `create_donation_order` MCP/WebMCP tool, so "Claude, give $25 a month to a mutual-aid group near me" ends in a PayPal Orders approval link.
  - It is cheap (6-8 h) and on-theme. But it competes with ShopBridge and AgentBaazar on their turf, and it is the less emotional side of the product.
  - **Verdict:** a reasonable alternative to item 6 only if npm publishing is blocked. Item 6 is better because it showcases the two-human approval token, which is our differentiator.

### Name, tagline and first 10 seconds

- **Name: keep Neighborline.** It is distinctive, it is not a Pay-/-Guard/-Pilot portmanteau, and it maps to the story. The only liability: "line" and "hotline" promise a phone, and today there isn't one. Either build item 7 or make sure the video says "web line" once (VIDEO_SCRIPT already avoids "calls").
- **Tagline:** lead with the user outcome (above). "Cash in minutes, not days" on the home page is good and should be the Devpost card's subtitle.
- **First 10 seconds (current draft): 4/10.** It opens on silence, a grey idle phone, instructional UI text and a grey 0:00.0.
- **First 10 seconds (target): 9/10.**
  - 0:00 Lan's real Vietnamese voice with subtitles.
  - 0:02 her bubble lands and the clock starts *in motion*.
  - 0:05 the read-back is heard in Vietnamese.
  - 0:08 VO: "She doesn't read English. Watch the clock."
  - Optional: a 1.5 s cold-open insert of a real hand holding a real phone, which also satisfies the "functioning on the device" wording in rules §4.

---

## 5. Disqualification and Stage-1 risks (ordered by severity)

1. **The repo is private.** `gh api repos/Aaaaarin/neighborline` returns `"private": true`. The rules require a public open-source repo with a visible license (the MIT LICENSE exists). **That alone is a certain DQ.** Flip it before submitting, and check that no secrets are in history (CI runs gitleaks, so confirm it ran green on `main`).
2. **No real PayPal sandbox call has ever been made.** The rules: "meaningfully integrate at least one PayPal technology … **using the free sandbox**", plus "a working prototype; mockups and non-functional demos do not qualify". A Stage-1 screener who reads "Sandbox: simulated" on every screen and "Real PayPal sandbox … **not run yet**" in the README can reasonably fail it. **Item 2 is mandatory, not optional.**
3. **There is no hosted demo.** It is not strictly required, but "working prototype" plus a GitHub-only link is the weakest form of that evidence, and many judges are non-technical.
4. **AI has only ever run in fixture mode.** "Meaningfully use AI" is satisfied *in code*, but a judge who tries `/call` on the hosted build will get offline echoes ("以下是我们理解的内容:" followed by her text verbatim, and `(offline mode, not translated)` on the organizer card). Ship with `AI_MODE=live` (item 4).
5. **Video rules (§4):** under 3:00 (the draft is 2:40 ✓); **public** on YouTube (not unlisted; VIDEO_SCRIPT already says Public ✓); no third-party trademarks (plain-word "PayPal" and "Venmo" are fine; keep `/donate` SDK buttons out of the frame ✓); no copyrighted music ✓; disclose the synthetic voices ✓. **Fix the literal `HOSTED_URL` on the end card.**
6. **English:** fine. All non-English content is subtitled.
7. **Commit history:** all 74 commits are dated Oct 16, 2026, which is inside the submission window ✓. The density ("built in a day by agents") is honest and documented in README "AI tools used". It is not a DQ, but expect the "do you understand this code?" probe. THREAT_MODEL's "Reviewing AI-written code" section is the answer, so link it from Devpost.
8. **Fictional sponsor naming:** two different sponsor names could look like a sloppy fabrication. It is not a DQ, but fix it (item 3).

---

## 6. One-line verdict per persona (what they would say in deliberation)

- **Jo:** "The best schema-repair pipeline I've seen this year, and I couldn't make it run on a real model."
- **Eddie:** "I'd fork this for my community tomorrow, if I could see the repo."
- **Marco:** "Beautiful, honest, and entirely simulated. Show me one real sandbox id."
- **Sr PM:** "This is the Halo-Award story with a product behind it. The `/trust` page answered my legal question before I asked."
- **Eng Manager:** "The approver is production-grade. The ledger demo data contradicts itself."
- **Veteran:** "Most Impactful favourite if the video opens on her voice and the link works. Otherwise it's a very good README."
