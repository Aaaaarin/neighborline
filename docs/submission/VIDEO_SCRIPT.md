# Neighborline: demo video script (Draft 2, 2:40.5)

**Audience:** PayPal DevRel, product and engineering judges, plus sponsor judges. They watch at about 1.5× and
decide within the first 60–90 seconds.
**Rules we design to:** the video is under 3:00 and on YouTube. It shows the project working end to end. It uses no
copyrighted music. It shows no third-party logos. "PayPal" and "Venmo" appear only as plain words, never as logos or
logo-styled buttons. The [official rules](https://paypalaihackathon.devpost.com/rules) (§4, fetched Oct 16, 2026) say
the video "should be less than three (3) minutes", "should include footage that shows the Project functioning on the
device for which it was built", "must be uploaded to and made publicly visible on YouTube", and "must not include third
party trademarks, or copyrighted music or other material" unless the entrant has permission. Judging criterion (§6):
"Does the video clearly demonstrate the project working end-to-end?"

**The story in one line:** Mrs. Lan's voice is the first thing you hear and her phone is the main character. The video
opens on her voice note, cuts to her phone and the stopwatch, and closes on her phone after it turns warm.

**What changed in Draft 2** (JUDGE-PANEL-2 #5): the first 5 s are her voice note (waveform, her Vietnamese words, the
English underneath) with the hook line on screen at 0.3 s, not an idle phone; approval 2 is a real tap as Marcus, signed
by a passkey on a virtual WebAuthn authenticator; every take is re-recorded on the current build (story clock 7:42,
Rosa's 6-second claim beat); the stale code card, test count and `HOSTED_URL` are gone; a 12-second MCP agent beat is
added; `/report` is trimmed to 9 s. The pipeline and the shot timecodes live in `video/timeline.json`; the resolved
cut is `video/edl.json`.

**Hard constraints this script meets**

| Constraint | Where it is met |
|---|---|
| Hook in the first 3 s | 0:00–0:05: her voice note plays (waveform, her Vietnamese words lighting up, the English under them). The hook line *"Leave a voice note in any language. Two neighbors approve. Cash lands in PayPal or Venmo."* is on screen from 0:00.3 (fully in by 0:00.7) |
| No idle phone, no "Press Play" | The first stage frame is P+0.2: the voice bubble is already arriving and the clock already runs |
| No dashboard in the first 60 s | Until 1:30.5 we show only phones, the stopwatch, the voice-note card and one title card. The PayPal rail first fills the frame at 1:40.5 |
| Working end to end by 1:30 | Lan goes from voice note to PayPal `SUCCESS` to a message back in Vietnamese at **0:27.3** (stage {T} = 0:22.4, Play at 0:04.8) |
| A real human signature in the hero | Approval 2 at 0:25.7 is a real click as Marcus and a real WebAuthn ceremony; the card reads "Signed with passkey · Visitor’s device (as Marcus)", and a 1.6× inset holds it on screen |
| Rosa's unclaimed rescue | 0:57–1:21.5 (unclaimed at 1:09.3, claimed at 1:15.4) |
| 5-second impersonator block | 1:21.5–1:30.5 (the cut lands on the blocked card at 1:21.6) |
| Under the hood | 1:30.5–2:05.5: the trust page, the rail and 4 code cards |
| Best Use of PayPal + AI | 2:05.5–2:17.5: an AI agent through `neighborline-payouts-mcp`, refused without two signatures, paid with them |
| Impact and ask | 2:17.5–2:40.5 |
| Total ≤ 2:50 | **2:40.5** |
| VO ≤ 380 words, every line ≤ ~160 wpm in its slot | **326 words**; the fastest line is V4 at 154 wpm (table in §2) |

---

## 0. Before recording: decisions that change the words on screen

1. **Which PayPal mode.**
   - The web app runs on the real engine in both modes. Record with `PAYPAL_MODE=sandbox` only once the real-sandbox spike has passed (README "Sandbox reality"); until then record with `PAYPAL_MODE=fake`.
   - In fake mode the rail shows "Sandbox: simulated". Every lower third then says **"simulated PayPal sandbox"**, and V3 drops the word "PayPal's" (alternate line given below).
   - In sandbox mode nobody can claim Rosa's payout, so Shot 7's `SUCCESS` beat exists only in fake mode. A sandbox cut ends Shot 7 on the claim help.
   - Never record a take whose labels say "sandbox" while the ids come from the fake.
2. **The real stopwatch number.** The stage stopwatch measures wall-clock time from `request.created` to the `SUCCESS` webhook.
   - At `speed=1` the Lan run freezes at about **0:22.5** (Draft 2 take, Oct 16, production build, fake mode: read-back 1.6 s, confirmed 8.7 s, Dana 14.8 s, Marcus tapped at 20.5 s and signed at 20.9 s, batch 21.0 s, `SUCCESS` webhook 22.5 s; the stopwatch froze at **0:22.4**, split 0:19.2 neighbors deciding / 0:03.1 system). Runs vary by ±0.2 s.
   - Read the exact value off the take and put it in `{T}` everywhere below and in the thumbnail.
   - **Do not use `speed=3` for the hero shot.** It shows compressed time, and a judge who reads the code will notice.
3. **The organizers tap on cue.** Say so on screen (the 0:31.6 lower third, and the approval-2 lower third says *we* tapped as Marcus). The veteran-judge research is explicit: judges forgive a labelled shortcut but never a hidden one.
4. **"Calls you back."** Phone, SMS and WhatsApp messages are not built (see the `/trust` "Not yet" row). Neighborline messages the neighbor back **in her thread on the web line**. The VO therefore says "messages her" and "a message in Vietnamese", never "calls" or "texts". If a Twilio channel ships, change line V5.
5. **"Approval service holds the credentials."** Shipped: `apps/approver` is a separate process and the only one with Payouts credentials. V7 uses the separate-service wording.
6. **Passkeys and demo keys.** Every approval is a WebAuthn signature over the approval hash. In the Draft 2 hero take Dana is scripted and signs with her **labelled demo key** ("Dana: signed with demo key"). Marcus is the manual path: `/demo?scenario=lan&mode=manual&speed=1` ("I’ll approve as Marcus" on), and the recorder clicks Approve at P+20.4 on a **virtual WebAuthn authenticator** (Chrome DevTools `WebAuthn.addVirtualAuthenticator`, user verification on). The ceremony is real (the visitor's passkey is enrolled, then signs); only the finger is simulated. The card reads "Signed with passkey · Visitor’s device (as Marcus)": the recorder's user agent is Linux, so the app says "device", and we did not spoof a Mac. The lower third says so ("We tapped as Marcus, on cue · a virtual WebAuthn authenticator in Chrome"). A human re-take on a Mac with Touch ID would read "Visitor’s Mac (as Marcus)" and could drop the word "virtual". Never call a demo-key signature a passkey on screen.
7. **One speed framing.** The stopwatch is split into "Neighbors deciding" and "System". Quote the system time as the speed claim ("the machine part took about three seconds") and say that the people take as long as they need. Never "90 seconds". Landing copy: "minutes, not days".

---

## 1. Shot-by-shot script

Coordinates are CSS pixels on a 1920×1080 viewport. `RECORDING_PLAN.md` gives the crop boxes in source pixels. Every
time below is the Draft 2 cut (`video/edl.json`); P+x is seconds after the Play click in that take.
**Persistent corner tag** (top-left, Be Vietnam Pro, `--ink-3` on a `--paper-raised` pill), on from 0:00 to 2:26.5 except during the MCP clip (2:05.5–2:17.5, whose own header carries the label):
`PayPal sandbox · test money · fictional people · AI voices`. In fake mode it reads
`Simulated PayPal sandbox · fictional people · AI voices`.

### Shot 1. Cold open: her voice note (0:00–0:05)
- **Visual:** a full-frame voice-note card on `--paper`, rendered frame by frame (`video/lib/voicenote.mjs`). No phone, no stopwatch, no "Press Play".
  - A frost voice-note bubble with a pause glyph; its waveform fills left to right as she speaks (0:00.2–0:04.7). With `--with-vo` the bars and the word timing come from the real voice file.
  - Above it: `Voice note · Mrs. Lan · Vietnamese · 7:42 AM`.
  - Under it, her words in Vietnamese light up as she says them: "Xin chào, tôi là bà Lan, ở khu Eastside. Sau trận bão băng, nhà tôi bị mất điện hai ngày nay rồi." (the first two sentences of the intake fixture, `lan_vi.json`).
  - Under that, in English, each sentence as hers starts: "Hello, I’m Mrs. Lan, from the Eastside. After the ice storm, my house has been without power for two days now."
- **Hook line (0:00.3, top, Literata):** **"Leave a voice note in any language."** / "Two neighbors approve. Cash lands in PayPal or Venmo."
- **Audio:** Mrs. Lan's voice note (synthetic Vietnamese TTS, `sage`, phone-speaker EQ) from 0:00.2. No narrator until 0:05.4.
- **Captions:** none burned (the card is the subtitle); the SRT carries "[Mrs. Lan, in Vietnamese] Hello, I’m Mrs. Lan…".

### Shot 2. The voice note lands and the clock runs (0:05–0:14)
- **Visual:** take `LAN` from P+0.2, composition A: her phone (left) and the big stopwatch (right), already running. The read-back in Vietnamese with "Nghe lại" (listen again) and its `EN` line land at 0:06.4; "Đúng rồi" (that's right) at 0:13.5.
- **Lower third (0:05.2–0:10):** `Eastside, the morning after an ice storm` / `The clock starts when her voice note arrives`
- **VO V1 (0:05.4–0:13.9):** "Mrs. Lan doesn't read English, and her power's been out two days. She just left a voice note. Watch the clock."

### Shots 3–4. Two phones buzz; approve, approve with a passkey; paid (0:14–0:31)
- **Visual:** composition B, all three phones (Lan · Dana · Marcus) and a small stopwatch, real time, no cuts.
  - Both organizer cards: `$150 · Policy v1 · Utility outage · up to $150 per request · To Venmo @lan-nguyen54`, chips "Handle checked", "Destination not reused", "Within caps".
  - 0:19.6: Dana approves (scripted, "Dana: signed with demo key"). Marcus's phone shows **Your turn** and the stopwatch says "Waiting for you to approve as Marcus".
  - 0:25.3: a tap ring on Marcus's **Approve $150**; the button spins through the WebAuthn ceremony; 0:25.7 approval 2 of 2.
  - 0:26.2–0:31: a 1.6× inset (right column) of Marcus's card: `Dana ✓ You ✓ 2 of 2 approvals`, `Dana: signed with demo key`, **`Signed with passkey · Visitor’s device (as Marcus)`**.
  - 0:27.3: Lan's phone warms from frost to amber, and `$150 · Venmo · Tiền đã đến` (the money has arrived) lands. The stopwatch freezes amber at **{T} = 0:22.4**.
- **Lower thirds:** 0:14.4–0:19.4 `Amount computed by code from the group’s written rules` / `Policy v1 · Utility outage · up to $150`. 0:25.9–0:30.9 `Approval 2 of 2 · signed with a passkey` / `We tapped as Marcus, on cue · a virtual WebAuthn authenticator in Chrome · Dana: labelled demo key`.
- **VO V2 (0:14.1–0:25.1):** "She heard it read back in Vietnamese and said yes. The group's own rules, not the AI, set the amount: a hundred and fifty dollars. Two organizers sign."
- **VO:** silence from 0:25.1 to 0:31.4, across the tap and the money moment. No SFX.

### Shot 5. Push in on her phone (0:31–0:44)
- **Visual:** composition A, warm phone, frozen amber stopwatch, slow 4 % push-in on the paid bubble ("Chào bà Lan ạ. Chúng cháu đã gửi $150 vào Venmo của bà…" with its `EN` line "Hi Lan. $150 has been sent to your Venmo. We hope it helps. Take care.").
- **Lower third (0:31.6–0:43.4):** `Voice note → PayPal SUCCESS: 0:22.4` / `Approvals on cue in this demo · simulated PayPal sandbox`
- **VO V3 (0:31.4–0:43.6):** "Paid, into her Venmo, with a message in Vietnamese. Twenty-two point four seconds to the SUCCESS webhook, on our PayPal stand-in. The approvals came on cue; real neighbors take longer."
  - *Sandbox alternate:* "…Twenty-two point four seconds to PayPal's SUCCESS webhook. The approvals came on cue; real neighbors take longer."
  - If Venmo had to use PayPal's sandbox mock (`POSPYO003`), add to the lower third: `Venmo item: PayPal's documented sandbox mock`.

### Shot 6. Name, problem, proof (0:44–0:57)
- **Visual:** HTML title card on `--paper`: wordmark, **"A hotline, not a dashboard."**, and two sourced lines: "300 relief requests overnight, in Instagram comments." (LA Public Press, Jan 2025, Mutual Aid LA Network after the Eaton fire) and "Fake Venmo handles, one letter off the real group’s." (Chronicle of Philanthropy, Apr 2026).
- **VO V4 (0:44.3–0:56.8):** "This is Neighborline: a hotline, not a dashboard. After the Eaton fire, one LA mutual-aid network took three hundred requests overnight, in Instagram comments. Most still run on a volunteer's personal Venmo."

### Shot 7. Rosa: unclaimed, then rescued (0:57–1:21.5)
- **Visual:** take `ROSA` (`speed=2`), composition A 0:57–1:04, composition B 1:04–1:08.4 (both approvals, the same two-phone pattern), then A again.
  - 1:09.3 **UNCLAIMED**, and the Spanish claim help lands: "Le enviamos $100 por PayPal, pero todavía no lo ha cobrado. Para recibirlo, abra PayPal o regístrese con el mismo correo o número de teléfono que nos dio…" (the app's `EN` line under it: "We sent $100 to PayPal, but it has not been claimed yet. To get it, open PayPal or sign up with the same email or phone number you gave us…"). The stopwatch says "Unclaimed — helping Rosa claim it".
  - 1:15.4 **SUCCESS** (fake mode: the PayPal stand-in plays her claim ~6 s after the help message; the rail says "Her claim is scripted in this demo"). Her phone warms: "$100 · PayPal · El dinero llegó".
- **Pill (0:57–1:21.5):** `Shown at 2× speed`
- **Lower thirds:** 1:09.4 `PayPal webhook` / `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` until 1:15.4, then `…SUCCEEDED · her claim is simulated` for 5.5 s.
- **VO V5:** "Rosa asks for groceries, in Spanish. Same rules, two approvals." (0:57.5–1:02.5) … "Her email has no PayPal account yet: unclaimed. She gets claim help in Spanish." (anchored to UNCLAIMED + 0.3 s: 1:09.6–1:15.2) … "She claims it. Success. Most payout systems stop at unclaimed; this one follows through." (1:15.6–1:21.3)

### Shot 8. The impersonator, blocked in about a second (1:21.5–1:30.5)
- **Visual:** take `BLOCKED` from P+1.64 (the stage flags the message at P+1.33 and the blocked card is on screen from P+1.64, so the cut lands on it; the empty "Nobody is waiting" frames are gone), composition C: the unknown sender's phone plus Dana's, and a 2× zoom of the blocked card. At 1:21.6 the red "Lookalike handle blocked" chip appears and "Approve disabled" greys out the button.
- **Overlay (1:22.2–1:30.5):** `@eastside-mutualaid ← the group` / `@eastside-mutuaiaid ← the text message`
- **Lower third (1:21.9–1:30.5):** `Blocked before any money moved · 0:01.2` / `Lookalike handle · Approve disabled on every phone`
- **VO V6 (1:21.9–1:30.3):** "Someone posing as the organizers, with a Venmo handle one letter off? Approve is disabled on every phone. No money moves."

### Shot 9. Under the hood: who can do what (1:30.5–1:40.5)
- **Visual:** `/trust`, "Know your agent: who can do what", slow vertical pan: the dashed "Cannot move money" box, then the chain down to "Approval service — a separate process, the only one with PayPal Payouts credentials".
- **VO V7a (1:30.8–1:45.2, runs into Shot 10):** "Under the hood: the agents that talk to neighbors have no PayPal tools. One separate approval service holds the Payouts credentials, and it pays only on a record signed with the passkeys of two different organizers."

### Shot 10. The rail, full screen (1:40.5–1:45.5)
- **Visual:** the finished Lan stage, framed, pushing toward the PayPal rail: `sender_batch_id nl_…`, `payout_batch_id`, `payout_item_id`, "Webhook verified · PAYMENT.PAYOUTS-ITEM.SUCCEEDED · signature checked", "Approval 2 of 2 · Marcus · Signed with passkey on Visitor’s device (as Marcus)", and the "Sandbox: simulated" chip.

### Shot 11. Code cards (1:45.5–2:05.5), 4 cards × 5 s
Atkinson Hyperlegible Mono 21 px, ink on `--paper-raised`, highlighted lines in `--frost`, file path and line range in the
header. The pipeline cuts each excerpt from the committed file by regex and fails loudly if an anchor moves.

| # | Time | File | What is highlighted |
|---|---|---|---|
| 1 | 1:45.5–1:50.5 | `packages/agents/src/validate.ts` (header comment + `summarizeTrace`) | "invalid? → ONE repair call…" and the `Schema repaired …` summary |
| 2 | 1:50.5–1:55.5 | `packages/core/src/approvals.ts` lines 144–183 (`canExecute`, `SENDER_BATCH_DOMAIN`, `senderBatchIdFor`) | `distinctApprovers(...) >= requiredApprovers(...)`, `SENDER_BATCH_DOMAIN = 'neighborline/paypal/sender_batch_id/v2'`, and ``return `nl_${sha256Hex(`${SENDER_BATCH_DOMAIN}\n${approval.id}\n${approval.hash}`).slice(0, 24)}` `` (the domain-separated derivation the approver calls) |
| 3 | 1:55.5–2:00.5 | `packages/paypal/src/webhooks.ts` | `path: '/v1/notifications/verify-webhook-signature'` and the raw-body splice |
| 4 | 2:00.5–2:05.5 | Terminal card: the real `pnpm test` summary per package, then `packages/paypal/src/reconcile.ts` `reconcile(…)` | **1093 tests pass** in Draft 4 (Oct 17, 2026, 11 packages; read from the cached run, never typed; `edl.json` holds this run). A fresh `pnpm test` now reads 1103 (the sandbox stand-in tests came after the cut); the card stays as recorded unless the video is re-cut |

- **VO V7b (1:45.6–1:50.4):** "AI output is schema-checked, repaired once, or the neighbor is asked again."
- **VO V7c (1:50.8–2:05.2):** "The batch ID is derived from the signed approval, so a double tap can't pay twice. Webhooks are signature-verified, and every payout is reconciled against PayPal Transaction Search. The test count is from a real run."
- Card 4's footer: `Open source · MIT · @neighborline/paypal + an MCP server that adds Payouts tools to the PayPal Agent Toolkit`.

### Shot 12. An AI agent pays, only with two signatures (2:05.5–2:17.5)
- **Visual:** `takes/mcp-demo.mp4` from 0.9 s, full frame (recorded by `pnpm --filter @neighborline/example-mcp-agent-demo record`: the official MCP client over stdio, the real `neighborline-payouts-mcp` server, fake PayPal; the terminal's own header says "Real MCP over stdio · fake PayPal · scripted agent, no LLM").
  - 2:07.5 the agent calls `create_payout_batch` with no approval token: **✗ Refused**: "an agent cannot authorize a payout on its own".
  - 2:10.4 two organizers approve that exact batch; an HMAC token bound to it is minted.
  - 2:13.5 the agent retries with the token: batch created; 2:14.6 `SUCCESS`; 2:16.2 reconciled against Transaction Search.
- **Lower third (2:07.8–2:14.4, gone before the step-3 output reaches it):** `neighborline-payouts-mcp · open source, in @neighborline/paypal` / `No approval token: refused · two organizers sign: paid, SUCCESS, reconciled`
- **VO V10 (2:05.8–2:17.3):** "For agent builders: the same guard ships as an MCP server. An AI agent asking to pay is refused without two humans' signatures. With them, it pays."
- The example now uses the main story's cast: Dana and Marcus approve Mrs. Lan's `@lan-nguyen54` (fixed Oct 17; take re-recorded, 14.6 s, markers: refused 2.95, approval 2 6.29, success 10.01, reconciled 11.65). Re-render to pick it up.

### Shot 13. Where the money went (2:17.5–2:26.5)
- **Visual:** `/report`, hold 3 s on "Where the money went" and "Every number checked against the ledger", then pan to "Are approvals fair across languages?".
- **Lower third:** `Seeded demo data · fictional group` / `The report’s figures are fixtures`.
- **VO V8 (2:17.8–2:26.3):** "Donors give with PayPal or Venmo. The public report never names a neighbor, and every number comes from the ledger."
  - The "about nine hundred volunteer groups" line (Mutual Aid Hub, via Spotlight on Poverty) moved to the video description.

### Shot 14. Close and ask (2:26.5–2:40.5)
- **Visual:** composition A with Mrs. Lan's warm phone; the right side cross-fades (320 ms) from the stopwatch to the end card:
  - **Neighborline**
  - `Try the hotline, no login` / **Live demo link in the description** (until deployed; with `HOSTED_URL` set the card prints `neighborline.onrender.com/demo` instead)
  - `Open source (MIT)` / `github.com/Aaaaarin/neighborline`
  - `Built for the PayPal AI Hackathon`
- **VO V9 (2:27–2:38):** "Neighborline is open source. Try the hotline yourself; the link is below. Because the morning after a storm, help should sound like your own language."
- **2:38.3:** the porch-light dot in the wordmark lights amber; silence to 2:40.5.

---

## 2. Voiceover, clean copy (for TTS and the word count)

Fit = words ÷ window. The target is ≤ ~160 wpm in every slot (TTS at `coral`, "unhurried"); the build re-checks it
and `edl.json → vo[]` keeps the resolved numbers. Mrs. Lan's Vietnamese (Shot 1) is not counted and is never sped up.

| Line | Window | Seconds | Words | wpm needed | Text |
|---|---|---|---|---|---|
| V1 | 0:05.4–0:13.9 | 8.5 | 21 | 148 | Mrs. Lan doesn't read English, and her power's been out two days. She just left a voice note. Watch the clock. |
| V2 | 0:14.1–0:25.1 | 11.0 | 28 | 153 | She heard it read back in Vietnamese and said yes. The group's own rules, not the AI, set the amount: a hundred and fifty dollars. Two organizers sign. |
| V3 | 0:31.4–0:43.6 | 12.2 | 30 | 148 | Paid, into her Venmo, with a message in Vietnamese. Twenty-two point four seconds to the SUCCESS webhook, on our PayPal stand-in. The approvals came on cue; real neighbors take longer. |
| V4 | 0:44.3–0:56.8 | 12.5 | 32 | 154 | This is Neighborline: a hotline, not a dashboard. After the Eaton fire, one LA mutual-aid network took three hundred requests overnight, in Instagram comments. Most still run on a volunteer's personal Venmo. |
| V5a | 0:57.5–1:02.5 | 5.0 | 10 | 120 | Rosa asks for groceries, in Spanish. Same rules, two approvals. |
| V5b | 1:09.6–1:15.2 | 5.6 | 14 | 150 | Her email has no PayPal account yet: unclaimed. She gets claim help in Spanish. |
| V5c | 1:15.6–1:21.3 | 5.7 | 14 | 147 | She claims it. Success. Most payout systems stop at unclaimed; this one follows through. |
| V6 | 1:21.9–1:30.3 | 8.4 | 21 | 150 | Someone posing as the organizers, with a Venmo handle one letter off? Approve is disabled on every phone. No money moves. |
| V7a | 1:30.8–1:45.2 | 14.4 | 36 | 150 | Under the hood: the agents that talk to neighbors have no PayPal tools. One separate approval service holds the Payouts credentials, and it pays only on a record signed with the passkeys of two different organizers. |
| V7b | 1:45.6–1:50.4 | 4.8 | 12 | 150 | AI output is schema-checked, repaired once, or the neighbor is asked again. |
| V7c | 1:50.8–2:05.2 | 14.4 | 36 | 150 | The batch ID is derived from the signed approval, so a double tap can't pay twice. Webhooks are signature-verified, and every payout is reconciled against PayPal Transaction Search. The test count is from a real run. |
| V10 | 2:05.8–2:17.3 | 11.5 | 27 | 141 | For agent builders: the same guard ships as an MCP server. An AI agent asking to pay is refused without two humans' signatures. With them, it pays. |
| V8 | 2:17.8–2:26.3 | 8.5 | 20 | 141 | Donors give with PayPal or Venmo. The public report never names a neighbor, and every number comes from the ledger. |
| V9 | 2:27–2:38 | 11.0 | 25 | 136 | Neighborline is open source. Try the hotline yourself; the link is below. Because the morning after a storm, help should sound like your own language. |
| | | | **326** | | Budget ≤ 380. `{T}` is read aloud exactly as the stopwatch shows it. |

Draft 1 → Draft 2 trims (each line was over ~160 wpm in its new slot): V1 28 → 21 words, V3 37 → 30, V4 35 → 32,
V5 40 → 38 (re-cut around the 6-second claim beat), V7 78 → 84 over a 34-second span (was 36 s), V8 39 → 20 (the
`/report` shot went from 18 s to 9 s).

**Delivery note for TTS or a human reader:** warm, unhurried, low and close to the mic, like a neighbor explaining
something at a kitchen table. No announcer energy. Stress the facts ("two different organizers", "two humans'
signatures"), not adjectives. Target about 150 words per minute.

---

## 3. Alternative V1 lines

1. **The stakes line:** "She doesn't read English, she has no bank app, and her power's been out two days. Watch the clock." (19 words, 134 wpm in V1's slot)
2. **The contrast line:** "After the Eaton fire, one group got three hundred requests overnight, in Instagram comments. This is the same morning, with a hotline." (22 words, 155 wpm; then cut the Eaton sentence from V4)

Keep V1 as the default: by 0:14 a judge has heard her, read the promise, and been told to watch the clock.

---

## 4. Where sandbox and synthetic labels appear (checklist)

| Label | Where | Why |
|---|---|---|
| Corner tag `PayPal sandbox · test money · fictional people · AI voices` | 0:00–2:26.5, top-left (off 2:05.5–2:17.5) | One persistent, honest disclosure that never blocks the story |
| `We tapped as Marcus, on cue · a virtual WebAuthn authenticator in Chrome · Dana: labelled demo key` | 0:25.9–0:30.9 | Approval 2 is a real click and a real passkey ceremony, but the finger is simulated and the timing is ours |
| `Approvals on cue in this demo` | 0:31.6–0:43.4 | Dana is scripted and we chose when to tap; the stopwatch is real wall-clock time |
| `Shown at 2× speed` | 0:57–1:21.5 | The Rosa take uses `speed=2` |
| `…SUCCEEDED · her claim is simulated` | 1:15.4–1:20.9 | In fake mode the PayPal stand-in plays Rosa's claim |
| Terminal header `Real MCP over stdio · fake PayPal · scripted agent, no LLM` | 2:05.5–2:17.5 | The MCP beat is a scripted agent (no model call) against the fake |
| `Sandbox: simulated` chip (product UI) | Visible in Shots 10 and 12 in fake mode | Comes from the app itself; do not hide it |
| `Venmo item: PayPal's documented sandbox mock` | Shot 5, only if the Venmo spike fails | Sandbox Venmo settlement is unverified (docs/PAYPAL.md) |
| `Seeded demo data · fictional group` | 2:17.5–2:26.5 | The report figures are fixtures |
| YouTube "altered or synthetic content" box | Upload settings | Mrs. Lan's voice is a realistic AI voice of a fictional person. Disclose it: YouTube Studio's "Altered or synthetic content" question at upload |

---

## 5. Recording checklist (human or agent)

**Display and browser**
- [ ] Record at 1920×1080 CSS px. If the recorder supports it, use device scale factor 2 and a 3840×2160 capture, so phone close-ups stay sharp when cropped (see RECORDING_PLAN.md step 0).
- [ ] Browser zoom 100 % (Ctrl/Cmd+0). The `/demo` 4-column layout needs a viewport ≥ 1680 px wide (`stage:` breakpoint).
- [ ] Light theme (`colorScheme: 'light'`). The dark "blackout night" palette is for one gallery image only.
- [ ] Hide the bookmarks bar (Ctrl/Cmd+Shift+B), extensions, the profile avatar and the address bar. Use app or kiosk mode, or Playwright, which has no chrome.
- [ ] Hide scrollbars (inject `::-webkit-scrollbar{display:none}`). Turn the cursor off, or use a large, slow cursor only where a click is the point (Marcus's "Approve $150" in an optional manual take).
- [ ] Use a fresh profile: no autofill, no password manager popovers, no translation bar (Chrome offers to translate Vietnamese, so start with `--lang=en-US` and disable the translate UI).
- [ ] Start every take in a fresh browser context: each visitor's runs are separate and demo runs never count against caps, so no reset is needed. (`/api/demo/reset` is not public; it needs the internal HMAC.)

**Machine**
- [ ] OS notifications off (macOS Focus or Do Not Disturb; Windows Focus Assist; Linux: no notification daemon in the headless recorder). Quit Slack, mail and calendar.
- [ ] Clock and status bar hidden or cropped out. The in-app phone clocks read 7:42, which is fine.
- [ ] Power plugged in, no low-battery dialogs. Turn off screen savers and auto-lock.

**Voiceover**
- [ ] Human take: a quiet small room with soft furnishings, a cardioid USB mic 10–15 cm away with a pop filter. Record 48 kHz/24-bit WAV, one file per line (V1–V9), 3 takes each. Leave 1 s of room tone at the start of the session for noise reduction.
- [ ] TTS take: see RECORDING_PLAN.md. Generate each line separately so it can be re-timed, and use the same voice and instructions for every line.
- [ ] Mrs. Lan's and Rosa's voices are synthetic. Disclose this in the corner tag and in the YouTube setting. Have a native speaker check the Vietnamese and Spanish audio and the on-screen translations before publishing.
- [ ] Mix: VO peaks around −6 dBFS, music bed 20–24 dB under VO, final loudness −14 LUFS integrated, −1 dBTP.

**Music (optional; silence is better than a risky track)**
- [ ] **YouTube Audio Library** (YouTube Studio → Audio Library). Filter to "Attribution not required". Download the track, keep a screenshot of its license line, and put the track name in the description. This is the safest source for a YouTube upload, because it will not trigger Content ID.
- [ ] Alternatives, if the license is kept: Pixabay Music (Pixabay Content License; can still occasionally trigger third-party Content ID claims), and Free Music Archive tracks licensed **CC BY** (credit required in the description; avoid NC and ND tracks).
- [ ] Mood: sparse piano or soft pads, slow tempo, no drums under the VO. Drop the music completely from 0:24 to 0:33 (the money moment) and bring it back softly on the warm screen.
- [ ] Never use commercial songs, "royalty free" tracks from unknown sites, or AI-generated music unless its license explicitly allows this use.

**Content and trademarks**
- [ ] No PayPal or Venmo logos, no PayPal-blue logo buttons, no Smart Button close-ups. The `/donate` page's SDK buttons render official marks, so keep `/donate` out of the video.
- [ ] No real people, real handles or real neighborhoods' victims. All names are fictional, and `example.com` emails are fine.
- [ ] Final duration is under 2:50, leaving 10 s of margin under the 3:00 limit.
- [ ] Watch the export once at 1.5× and once muted. The story must survive both: the captions carry it when muted.

**YouTube upload**
- [ ] Title: `Neighborline: a voice note in any language becomes PayPal or Venmo cash, approved by two neighbors`
- [ ] Visibility: **Public** (the rules require "publicly visible on YouTube"). Upload the SRT as closed captions in addition to the burned-in captions. Use a custom thumbnail (THUMBNAIL_BRIEF.md). Turn off "Made for kids". Check the synthetic-content disclosure box.
- [ ] Description: tagline, **the live demo link** (the end card and V9 point here), the repo URL, chapter timestamps (0:00 Mrs. Lan · 0:57 Unclaimed rescue · 1:21 Impersonator · 1:30 Under the hood · 2:05 AI agents and MCP · 2:17 Impact), the sources for the stats (incl. Mutual Aid Hub's ~900 groups), and the music credit.
