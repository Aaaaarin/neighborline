# Neighborline: demo video script (target 2:45)

**Audience:** PayPal DevRel, product and engineering judges, plus sponsor judges. They watch at about 1.5× and
decide within the first 60–90 seconds.
**Rules we design to:** the video is under 3:00 and on YouTube. It shows the project working end to end. It uses no
copyrighted music. It shows no third-party logos. "PayPal" and "Venmo" appear only as plain words, never as logos or
logo-styled buttons. [VERIFY against https://paypalaihackathon.devpost.com/rules: the rules page could not be fetched
on Oct 16. Check the trademark and music clauses and paste the exact wording into this file before recording.]

**The story in one line:** Mrs. Lan's phone is the main character. The video opens on her phone and stopwatch, and
closes on her phone after it turns warm.

**Hard constraints this script meets**

| Constraint | Where it is met |
|---|---|
| Hook in the first 10 s with Mrs. Lan and the stopwatch | 0:00–0:10. Her phone and the running stopwatch are on screen together from the first frame |
| No dashboard in the first 60 s | Until 1:36 we show only phones, the stopwatch and one title card. The PayPal rail panel first fills the frame at 1:46 |
| Working end to end by 1:30 | Lan goes from voice note to PayPal `SUCCESS` to a callback in Vietnamese by **0:33** |
| Rosa's unclaimed rescue | 1:00–1:27 |
| 5-second impersonator block | 1:27–1:36 (the block itself lands at 1:29) |
| Under the hood | 1:36–2:12: the trust page, the stage's rail and 4 code cards |
| Impact and ask | 2:12–2:45 |
| VO ≤ 380 words | **335 words** (counted below) |

---

## 0. Before recording: decisions that change the words on screen

1. **Which PayPal mode.**
   - Record with `PAYPAL_MODE=sandbox` if the web app is wired to the real packages by then. Check `apps/web/lib/server/services.ts`: `createServices()` must no longer return `MockEngine`.
   - If it is not wired, the rail shows "Sandbox: simulated". Every lower third then says **"simulated PayPal sandbox"**, and the VO line at 0:32 drops the word "PayPal's" (alternate line given below).
   - Never record a take whose labels say "sandbox" while the ids are generated locally.
2. **The real stopwatch number.** The stage stopwatch measures wall-clock time from `request.created` to the `SUCCESS` webhook.
   - At `speed=1` the scripted Lan run freezes at about **0:29** (approvals are scripted at +16.5 s and +23.5 s, and the webhook arrives 5.2 s after the batch).
   - Read the exact value off the take and put it in `{T}` everywhere below and in the thumbnail.
   - **Do not use `speed=3` for the hero shot.** It shows 0:09.6, which is compressed time, and a judge who reads the code will notice.
3. **The organizers tap on cue.** Say so on screen (the 0:32 lower third). The veteran-judge research is explicit: judges forgive a labelled shortcut but never a hidden one.
4. **"Calls you back."** Phone, SMS and WhatsApp messages are not built (see the `/trust` "Not yet" row). Neighborline messages the neighbor back **in her thread on the web line**. The VO therefore says "messages her" and "a message in Vietnamese", never "calls" or "texts". If a Twilio channel ships, change line V5.
5. **"Approval service holds the credentials."** Shipped: `apps/approver` is a separate process and the only one with Payouts credentials. V7 uses the separate-service wording.
6. **Passkeys and demo keys.** Every approval is a WebAuthn signature over the approval hash. In the hero take Dana and Marcus are scripted, so their taps are signed with **labelled demo keys** ("Dana: signed with demo key" on the card). For the 5-second passkey beat, record a take with "I'll approve as Marcus" on, on a laptop with Touch ID: the prompt appears, the card then reads "Signed with passkey · Visitor’s Mac (as Marcus)". Never call a demo-key signature a passkey on screen.
7. **One speed framing.** The stopwatch is split into "Neighbors deciding" and "System". Quote the system time as the speed claim ("the machine part took about five seconds") and say that the people take as long as they need. Never "90 seconds". Landing copy: "minutes, not days".

---

## 1. Shot-by-shot script

Coordinates are CSS pixels on a 1920×1080 viewport. `RECORDING_PLAN.md` gives the crop boxes in source pixels.
**Persistent corner tag** (top-left, 13.6 px Be Vietnam Pro, `--ink-3` on a `--paper-raised` pill), on from 0:00 to
2:30: `PayPal sandbox · test money · fictional people · AI voices`. In fake mode it reads
`Simulated PayPal sandbox · fictional people · AI voices`.

### Shot 1. Cold open: her phone, her voice (0:00–0:02)
- **Visual:** take `LAN`, the frames before Play is pressed. Composition A: Mrs. Lan's phone (crop) on the left half, and the big stopwatch (crop) on the right reading `0:00.0`, with the caption "The clock starts when the voice note arrives." Her phone's idle hint reads "Mrs. Lan's power has been out for two days." Battery 23 %.
- **URL:** `/demo?scenario=lan&speed=1` (Play is clicked by the recorder at a logged time, so the cold open has clean idle frames). Variant: `&autoplay=1` works, but it leaves no idle frames.
- **Audio:** Mrs. Lan's voice note, synthetic Vietnamese TTS of the fixture transcript, first sentence only, under −6 dB room tone.
- **Caption (burned in, her words):** "Hello, this is Lan on Hawthorne Street. My power has been out for two days…"
- **Lower third:** none yet.

### Shot 2. The voice note lands and the clock runs (0:02–0:12)
- **Visual:** same composition. The recorder clicks Play at 0:02, which is stage time 0.
  - The voice bubble appears, and the transcript fills in at 0:04.6.
  - The Vietnamese read-back bubble appears at 0:06.8, with the "Nghe lại" (listen again) chip.
  - The stopwatch runs in ink, not amber.
- **Lower third (0:02–0:07):** `Eastside, the morning after an ice storm` / `Mrs. Lan · Vietnamese · voice note`
- **VO V1 (starts 0:03.5):** "That's Mrs. Lan. Power out two days since the ice storm. She doesn't read English. She just left a voice note for her neighborhood hotline. Watch the clock."
- **Captions:** VO captions at the bottom. Above them, in smaller type, the read-back's English line when it appears: "The group's rules allow up to $150, sent to Venmo @lan-nguyen54. Is that right?"

### Shot 3. She says yes, and two phones buzz (0:12–0:18)
- **Visual:** at 0:11.5 the "Đúng rồi" (that's right) bubble appears on her phone. Hard cut at 0:12 to composition B: all three phones (Lan · Dana · Marcus) with a small stopwatch top-right.
  - Both organizer phones buzz in with the card: `$150 · Policy v1 · Utility outage · up to $150 · To Venmo @lan-nguyen54`, and the chips "Handle checked", "Destination not reused", "Within caps".
- **VO V2 (0:12.5–0:24):** "She heard it read back in Vietnamese and said yes. The group's own rules, not the AI, set the amount: a hundred and fifty dollars. Two organizers, on two phones."
- **Lower third (0:13–0:18), next to the organizer cards:** `Amount computed by code from the group's written rules`

### Shot 4. Approve, approve, paid (0:18–0:31)
- **Visual:** composition B continues in real time with no cuts.
  - Dana's chip turns to a check at 0:18.5, and Marcus's at 0:25.5.
  - At about 0:31 Lan's phone warms from frost to amber, and the `$150 · Venmo · Tiền đã đến` (the money has arrived) bubble lands.
  - The stopwatch freezes and turns amber at **0:{T}**.
- **VO:** silence from 0:24 to 0:32. Let the moment play. No SFX.
- **Caption (0:25.5):** `Approval 2 of 2 · two different organizers, two different keys`

### Shot 5. Push in on her phone (0:31–0:46)
- **Visual:** back to composition A, with the warm phone and the frozen amber stopwatch. Slow 4 % push-in (zoompan) on the paid bubble.
- **On-screen translation (under the bubble):** "Sent $150 to your Venmo (@lan-nguyen54). Transaction C1C4EB…3D08. If you don't see it, just reply here."
- **Lower third (0:33–0:44):** `Voice note → PayPal SUCCESS: 0:{T}` / `Organizers tapped on cue in this demo · PayPal sandbox`
- **VO V3 (0:32–0:45):** "Paid, into her Venmo, with a message in Vietnamese. {T-words} seconds from voice note to PayPal's SUCCESS webhook. Our organizers tapped on cue; with real volunteers, it's as long as two neighbors take to check their phones."
  - *Fake-mode alternate:* "…{T-words} seconds from voice note to the SUCCESS webhook, on our PayPal stand-in…"
  - If Venmo had to use PayPal's sandbox mock (`POSPYO003`), add to the lower third: `Venmo item: PayPal's documented sandbox mock`.

### Shot 6. Name, problem, proof (0:46–1:00)
- **Visual:** HTML title card on `--paper`.
  - Wordmark (line + lit dot), then in Literata 65 px: **"A hotline, not a dashboard."**
  - Two plain lines in Be Vietnam Pro 26 px, each with a 13.6 px source:
    - "300 relief requests overnight, in Instagram comments." (LA Public Press, Jan 2025, Mutual Aid LA Network after the Eaton fire)
    - "Fake Venmo handles, one letter off the real group's." (Chronicle of Philanthropy, Apr 2026)
- **VO V4 (0:46–1:00):** "This is Neighborline: a hotline, not a dashboard. After the Eaton fire, one LA mutual-aid network took three hundred requests overnight, in Instagram comments. Most groups still run on spreadsheets and a volunteer's personal Venmo."

### Shot 7. Rosa: unclaimed, then rescued (1:00–1:27)
- **Visual:** take `ROSA`, `/demo?scenario=rosa&speed=2`, Play clicked at video 1:00. Composition A with Rosa's phone; the stopwatch crop on the right shows the caption "Unclaimed — helping Rosa claim it" while she is unclaimed.
  - 1:02.4: the Spanish read-back appears.
  - 1:04.8: she confirms.
  - 1:08.3 and 1:11.8: the two approvals happen. Show a 2-second cut to composition B here so judges see the same two-phone pattern.
  - 1:14.4: **UNCLAIMED**. A Spanish claim-help message appears: "…ese correo todavía no tiene cuenta de PayPal…" ("…that email doesn't have a PayPal account yet…").
  - 1:19.7: **SUCCESS**. Her phone warms, and "¡Ya está! Los $100 llegaron a su PayPal" ("Done! The $100 reached your PayPal") appears.
  - Hold on that until 1:27.
- **Persistent caption (1:00–1:27):** `Shown at 2× speed`
- **On-screen translations:** under the claim-help bubble, "We sent $100, but that email has no PayPal account yet. To get it: open paypal.com, sign up with that same email… The money waits for you for 30 days." Under the success bubble, "It worked — the $100 is in your PayPal now."
- **Lower third (1:14–1:20):** `PayPal webhook: PAYMENT.PAYOUTS-ITEM.UNCLAIMED`, then `…SUCCEEDED`
- **VO V5:** "Rosa asks for groceries, in Spanish. Same rules, two approvals." (1:01–1:05) … "Her email has no PayPal account yet, so PayPal reports the payout unclaimed." (1:13–1:18) … "Most systems stop there. Neighborline messages her, in Spanish, exactly how to claim it." (1:18–1:23) … "She does. Success." (1:23–1:25)

### Shot 8. The impersonator, blocked in 5 seconds (1:27–1:36)
- **Visual:** take `BLOCKED`, `/demo?scenario=blocked&speed=1`, Play at 1:27.5. Composition C: the unknown sender's phone plus Dana's phone, cropped to the left 870 px.
  - At 1:29.3 the red "Lookalike handle blocked" chip appears, and "Approve disabled" greys out the button.
  - A 1.5× zoom on the handle line.
- **Overlay (1:30–1:35), mono type, stacked:**
  `@eastside-mutualaid   ← the group`
  `@eastside-mutuaiaid   ← the text message`
- **Lower third:** `Blocked before any money moved · 0:01.8`
- **VO V6 (1:28–1:36):** "Someone posing as the organizers, with a Venmo handle one letter off? Approve is disabled on every phone. No money moves."

### Shot 9. Under the hood: who can do what (1:36–1:46)
- **Visual:** `/trust`, scrolled to "Know your agent: who can do what". A slow vertical pan over the diagram.
  - Left: the dashed "Cannot move money" box (intake, notify, report agents).
  - Right: the chain down to the dark "Approval service — a separate process, the only one with PayPal Payouts credentials" box (true since `apps/approver` shipped; see decision 5).
- **VO V7, part 1 (1:36–1:46):** "Under the hood: the agents that talk to neighbors have no PayPal tools at all. One separate approval service holds the Payouts credentials, and it pays only on a record signed with the passkeys of two different organizers."

### Shot 10. The rail, now full screen (1:46–1:52)
- **Visual:** the full `/demo` stage at the end of the `LAN` take, the first full-frame view. Slow push toward the PayPal rail column:
  - `sender_batch_id nl_…`, `payout_batch_id`, `payout_item_id`
  - "Webhook verified · PAYMENT.PAYOUTS-ITEM.SUCCEEDED · signature checked"
  - the "Sandbox: simulated" chip, or no chip in sandbox mode
- **VO V7, part 2 (1:46–1:52):** "Every AI output is checked against a schema, repaired once, or the neighbor is asked again, never guessed."

### Shot 11. Code cards (1:52–2:12), 4 cards × 5 s
Plain, on-brand code cards: Atkinson Hyperlegible Mono 22 px, ink on `--paper-raised`, one highlighted line range in
`--frost`, and the file path and line range in the header. No syntax-colour rainbow.

| # | Time | File | What is highlighted |
|---|---|---|---|
| 1 | 1:52–1:57 | `packages/agents/src/validate.ts` (lines 1–12 header comment plus `summarizeTrace`, ~130–140) | "invalid? → ONE repair call…" and the `Schema repaired 1 field (payout.value)` summary string |
| 2 | 1:57–2:02 | `packages/core/src/approvals.ts` (`senderBatchIdFor`, ~line 164; `canExecute`, ~145) | `'nl_' + hash.slice(0, 24)` |
| 3 | 2:02–2:07 | `packages/paypal/src/webhooks.ts` (~lines 60–80) | `path: '/v1/notifications/verify-webhook-signature'` and the raw-body splice |
| 4 | 2:07–2:12 | Terminal card: `pnpm test` summary, then `packages/paypal/src/reconcile.ts` line 43 signature | The pass counts per package [VERIFY: paste the real numbers from the run] |

- **VO V7, part 3 (1:52–2:12):** "The batch ID is a hash of that approval, so a double tap can't pay twice. Webhooks are signature-verified, and a nightly job on Render reconciles every payout against PayPal Transaction Search."
- **Lower third on card 4:** `Open source · MIT · @neighborline/paypal + an MCP server that adds Payouts tools to the PayPal Agent Toolkit`

### Shot 12. Where the money went (2:12–2:30)
- **Visual:** `/report`. Hold on the headline "Where the money went" and the green chip "Every number checked against the ledger · 14 figures". Then a slow scroll to "Are approvals fair across languages?".
- **Lower third (whole shot):** `Seeded demo data · fictional group` (required: the report figures are fixtures).
- **VO V8 (2:12–2:28):** "Donors give with PayPal or Venmo. The public report is AI-written around numbers that code pulls from the ledger, and it never names a neighbor. Built for the roughly nine hundred volunteer groups that mobilize when the storm hits."
  - Source for "nine hundred": Mutual Aid Hub mapped about 900 active US groups by 2021 (Spotlight on Poverty). Put it in the video description, not on screen.

### Shot 13. Close and ask (2:30–2:45)
- **Visual:** composition A again, with Mrs. Lan's warm phone and the frozen amber stopwatch. The right side cross-fades (320 ms) from the stopwatch to an end card:
  - **Neighborline**
  - `Try the hotline, no login: {HOSTED_URL}/demo`
  - `Open source (MIT): github.com/Aaaaarin/neighborline`
  - `Built for the PayPal AI Hackathon`
- **VO V9 (2:30–2:41):** "Neighborline is open source. Try the hotline yourself, no login, at the link below. Because the morning after a storm, help should sound like your own language."
- **2:41–2:45:** silence. The porch-light dot in the wordmark lights up (the amber dot).

---

## 2. Voiceover, clean copy (for TTS and the word count)

| Line | Window | Words | Text |
|---|---|---|---|
| V1 | 0:03.5–0:12 | 28 | That's Mrs. Lan. Power out two days since the ice storm. She doesn't read English. She just left a voice note for her neighborhood hotline. Watch the clock. |
| V2 | 0:12.5–0:24 | 30 | She heard it read back in Vietnamese and said yes. The group's own rules, not the AI, set the amount: a hundred and fifty dollars. Two organizers, on two phones. |
| V3 | 0:32–0:45 | 37 | Paid, into her Venmo, with a message in Vietnamese. Twenty-nine seconds from voice note to PayPal's SUCCESS webhook. Our organizers tapped on cue; with real volunteers, it's as long as two neighbors take to check their phones. |
| V4 | 0:46–1:00 | 35 | This is Neighborline: a hotline, not a dashboard. After the Eaton fire, one LA mutual-aid network took three hundred requests overnight, in Instagram comments. Most groups still run on spreadsheets and a volunteer's personal Venmo. |
| V5 | 1:01–1:25 | 40 | Rosa asks for groceries, in Spanish. Same rules, two approvals. / Her email has no PayPal account yet, so PayPal reports the payout unclaimed. / Most systems stop there. Neighborline messages her, in Spanish, exactly how to claim it. / She does. Success. |
| V6 | 1:28–1:36 | 21 | Someone posing as the organizers, with a Venmo handle one letter off? Approve is disabled on every phone. No money moves. |
| V7 | 1:36–2:12 | 78 | Under the hood: the agents that talk to neighbors have no PayPal tools at all. One separate approval service holds the Payouts credentials, and it pays only on a record signed with the passkeys of two different organizers. / Every AI output is checked against a schema, repaired once, or the neighbor is asked again, never guessed. / The batch ID is a hash of that approval, so a double tap can't pay twice. Webhooks are signature-verified, and every payout is reconciled against PayPal Transaction Search. |
| V8 | 2:12–2:28 | 39 | Donors give with PayPal or Venmo. The public report is AI-written around numbers that code pulls from the ledger, and it never names a neighbor. Built for the roughly nine hundred volunteer groups that mobilize when the storm hits. |
| V9 | 2:30–2:41 | 27 | Neighborline is open source. Try the hotline yourself, no login, at the link below. Because the morning after a storm, help should sound like your own language. |
| | | **335** | Re-count after filling `{T}`. Budget is ≤ 380. |

**Delivery note for TTS or a human reader:** warm, unhurried, low and close to the mic, like a neighbor explaining
something at a kitchen table. No announcer energy. Stress the facts ("two different organizers", "never guessed"),
not adjectives. Target about 150 words per minute. V7 can run at 165.

---

## 3. Two alternative opening lines (replace V1)

1. **The stakes line (veteran-judge research):** "She doesn't read English, she doesn't have a bank app, and her power's been out for two days. Watch the clock." (22 words; saves about 3 s)
2. **The contrast line:** "After the Eaton fire, one mutual-aid group got three hundred requests overnight, in Instagram comments. This is the same morning, with a hotline instead. Her name is Lan." (28 words. If you use it, cut the Eaton sentence from V4 and give V4's time to Shot 5.)

Keep V1 as the default. It names her, places the storm and gives the instruction ("watch the clock") within 8 seconds,
while the clock is already visible.

---

## 4. Where sandbox and synthetic labels appear (checklist)

| Label | Where | Why |
|---|---|---|
| Corner tag `PayPal sandbox · test money · fictional people · AI voices` | 0:00–2:30, top-left | One persistent, honest disclosure that never blocks the story |
| `Organizers tapped on cue in this demo` | 0:33–0:44 | The approvals are scripted; the stopwatch is real wall-clock time |
| `Shown at 2× speed` | 1:00–1:27 | The Rosa take uses `speed=2` |
| `Sandbox: simulated` chip (product UI) | Visible in Shots 10 and 12 in fake mode | Comes from the app itself; do not hide it |
| `Venmo item: PayPal's documented sandbox mock` | Shot 5, only if the Venmo spike fails | Sandbox Venmo settlement is unverified (docs/PAYPAL.md) |
| `Seeded demo data · fictional group` | 2:12–2:30 | The report figures are fixtures |
| YouTube "altered or synthetic content" box | Upload settings | Mrs. Lan's voice is a realistic AI voice of a fictional person. Disclose it [VERIFY current YouTube policy wording] |

---

## 5. Recording checklist (human or agent)

**Display and browser**
- [ ] Record at 1920×1080 CSS px. If the recorder supports it, use device scale factor 2 and a 3840×2160 capture, so phone close-ups stay sharp when cropped (see RECORDING_PLAN.md step 0).
- [ ] Browser zoom 100 % (Ctrl/Cmd+0). The `/demo` 4-column layout needs a viewport ≥ 1680 px wide (`stage:` breakpoint).
- [ ] Light theme (`colorScheme: 'light'`). The dark "blackout night" palette is for one gallery image only.
- [ ] Hide the bookmarks bar (Ctrl/Cmd+Shift+B), extensions, the profile avatar and the address bar. Use app or kiosk mode, or Playwright, which has no chrome.
- [ ] Hide scrollbars (inject `::-webkit-scrollbar{display:none}`). Turn the cursor off, or use a large, slow cursor only where a click is the point (Marcus's "Approve $150" in an optional manual take).
- [ ] Use a fresh profile: no autofill, no password manager popovers, no translation bar (Chrome offers to translate Vietnamese, so start with `--lang=en-US` and disable the translate UI).
- [ ] Reset demo state before every take: `curl -X POST $BASE/api/demo/reset`.

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
- [ ] Visibility: Public (or Unlisted if the rules allow it [VERIFY]). Upload the SRT as closed captions in addition to the burned-in captions. Use a custom thumbnail (THUMBNAIL_BRIEF.md). Turn off "Made for kids". Check the synthetic-content disclosure box.
- [ ] Description: tagline, the hosted URL, the repo URL, chapter timestamps (0:00 Mrs. Lan · 1:00 Unclaimed rescue · 1:27 Impersonator · 1:36 Under the hood · 2:12 Impact), the sources for the stats, and the music credit.
