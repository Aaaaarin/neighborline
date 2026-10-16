# The phone line

**Status: built and tested, switches on with a Twilio number.** No Twilio account is connected to this
project yet, so nothing below has been tried against Twilio's live network. Everything is covered by tests that
send Twilio-shaped, correctly signed webhooks to the real engine (`apps/web/test/phone.test.ts`).

A neighbor with any phone (no smartphone, no data plan, no app) calls a number, says what they need in their
own language, hears it read back, presses 1, and gets a call back in their language when the money is sent.
It is the same engine as `/call`: the same intake agent, the same rules, the same two approvals.

## The call

```
Twilio                                   Neighborline (apps/web, /api/voice/*)
──────                                   ─────────────────────────────────────
call comes in ── POST incoming ────────▶ signature ok? caller rate limit? withheld number?
                                         create request (channel 'phone', contact.phone = caller)
           ◀── "Neighborline. After the beep, tell us what you need, in any language." (en, es, vi)
               <Record maxLength=120 playBeep trim-silence>
caller speaks, Twilio stores it
           ── POST recorded ───────────▶ "One moment while we listen" + <Redirect> wait
           ── POST recording-status ───▶ job: GET the .mp3 (Basic auth) → engine intake (STT, extraction,
                                         read-back) → DELETE the recording at Twilio → audit rows
           ── POST wait (every ~2 s) ──▶ job done?
           ◀── blocked by rail protection → the rail reply, goodbye
           ◀── no payout handle → read-back + "Press 1 to say your Venmo username, 2 for PayPal email"
                    ── POST payout ────▶ <Record> again → intake re-runs on the combined text
           ◀── a question with fixed answers (category) → keypad menu "For groceries, press 1…"
           ◀── otherwise → read-back in their language + "If that is right, press 1. To try again, press 2."
           ── POST confirm Digits=1 ───▶ engine confirm: code computes the amount, rail checks, queue
           ◀── "Thank you. Two neighbors will look at it. We will call or text you back." <Hangup/>

…two organizers approve, PayPal webhook SUCCESS (or UNCLAIMED)…

engine settle ── OutboundNotifier ─────▶ POST /Calls.json  (Twiml: the vetted paid / claim-help message,
                                         in their language, said twice) — SMS only with a verified sender
```

Where it lives:

| File | What |
|---|---|
| `apps/web/app/api/voice/[step]/route.ts` | The webhooks: `incoming`, `recorded`, `recording-status`, `wait`, `confirm`, `payout`, `menu` |
| `apps/web/app/api/voice/audio/[token]/route.ts` | Short-lived TTS clips for `<Play>` |
| `apps/web/lib/server/voice/call-flow.ts` | The state machine above |
| `apps/web/lib/server/voice/bridge.ts` | The engine entry point for channel `phone` (narrowed context: no approval service) |
| `apps/web/lib/server/voice/outbound.ts` | The outbound notify adapter (call-backs, quiet hours, idempotency) |
| `apps/web/lib/server/voice/signature.ts` | `X-Twilio-Signature` validation |
| `apps/web/lib/server/voice/twilio-api.ts` | The four REST calls (download, delete, call, SMS), plain `fetch` |
| `apps/web/lib/server/voice/phrases.ts` | What the line says around the read-back, in 10 languages |

The engine hook is small: `Engine.phone()` returns the bridge, `startIntake` accepts `contact` for channel
`phone`, and `settle.ts` / the unclaimed re-notify job hand each payout-status message to `ctx.outbound` when
the request has `contact.phone`.

## Set it up

1. **Twilio account.** Sign up at twilio.com, upgrade from trial (trial calls play a trial announcement and can
   only call verified numbers).
2. **Buy a number** with Voice capability (Console → Phone Numbers → Buy a number). A local US number is
   $1.15/month; toll-free is $2.15/month.
3. **Point the number at Neighborline.** Phone Numbers → Manage → Active numbers → your number → Voice
   configuration → "A call comes in": **Webhook**, `https://<your host>/api/voice/incoming`, **HTTP POST**.
   Leave the status callback empty. Every other URL the line uses comes from its own TwiML.
4. **Set the environment** on the web service (Render → Environment), then redeploy:

   | Variable | Required | Value |
   |---|---|---|
   | `TWILIO_ACCOUNT_SID` | yes | `AC…` from Console → Account info |
   | `TWILIO_AUTH_TOKEN` | yes | Auth token from the same page. Signs every webhook; never logged |
   | `TWILIO_PHONE_NUMBER` | yes | The number from step 2 in E.164, e.g. `+15035550199` (caller ID for call-backs) |
   | `PHONE_PUBLIC_BASE_URL` | if not on Render | The public `https://` origin Twilio calls. Defaults to `APP_BASE_URL`, then `RENDER_EXTERNAL_URL`. Must match the webhook URL exactly or signatures fail |
   | `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | no | Use an API key for REST calls instead of the auth token |
   | `TWILIO_SMS_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | no | A **verified** SMS sender. Without one the line never texts, it only calls |
   | `PHONE_QUIET_HOURS` | no | `21-8` (default): no call-backs from 21:00 to 08:00 local; `off` to disable |
   | `PHONE_TIMEZONE` | no | Overrides the group's time zone for quiet hours |
   | `PHONE_BLOCK_ANONYMOUS` | no | `true` (default): withheld numbers are asked to call again without hiding it (we can't call them back) |
   | `PHONE_MAX_CALL_SECONDS` | no | `600` (default) |
   | `PHONE_GREETING_LANGS` | no | `en,es,vi` (default): languages of the opening line |
   | `TWILIO_SAY_VOICES` | no | JSON overrides, e.g. `{"vi":"Google.vi-VN-Standard-A","ru":null}` (`null` = use our TTS) |
   | `AI_MODE=live` + `OPENAI_API_KEY` | for real calls | Real speech-to-text (gpt-4o-transcribe) and TTS. In `fixture` mode every caller "says" a sample |

5. **Check it.** `/trust` shows "Phone line: Live on (503) 555-0199", and `/call` shows a "Call the hotline"
   box. Call the number. Watch the request appear on `/organizer`.

Nothing else changes: the phone line has no PayPal credentials and cannot approve or pay (the bridge is built on
the intake context, which has no approval service).

### SMS and WhatsApp (optional, not needed for the line)

- **US SMS needs a registered sender.** Twilio blocks SMS from unregistered 10DLC numbers (error 30034, fully
  enforced since September 1, 2023) and from unverified toll-free numbers (error 30032, since January 31, 2024).
  Register an A2P 10DLC campaign or verify a toll-free number, then set `TWILIO_SMS_FROM` (or a Messaging
  Service). Voice calls need neither, which is why the line calls back by voice first.
- **WhatsApp** (not wired yet): the Twilio Sandbox for WhatsApp uses the shared number +1 415 523 8886; each
  tester sends `join <code>` and the opt-in lasts three days. Free-form replies are allowed for 24 hours after
  the neighbor's last message; outside that window only pre-approved templates can be sent, and the sandbox
  offers only three generic ones. A production WhatsApp sender needs Meta business verification.

## Languages

| Lang | Prompts | Read-back and call-back voice |
|---|---|---|
| English, Spanish, Vietnamese, Chinese (Mandarin), Arabic, French, Korean, Russian | written natively (`phrases.ts`) | Twilio `<Say>` Google Chirp3-HD voice (`en-US`, `es-US`, `vi-VN`, `cmn-CN`, `ar-XA`, `fr-FR`, `ko-KR`, `ru-RU`) |
| Tagalog / Filipino | written natively | Twilio `<Say>` `Google.fil-PH-Standard-A` |
| Haitian Creole | written natively | **No Twilio voice.** Our TTS (gpt-4o-mini-tts) → `<Play>` of a signed URL that expires in 10 minutes (30 for call-backs). In fixture mode, the English rendering |

Why `<Record>` + our own speech-to-text instead of `<Gather input="speech">`: Gather needs the caller's language
up front (`language`, default `en-US`), and its recognizers do not list Haitian Creole. A recording transcribed by
gpt-4o-transcribe detects the language itself, so one opening line works for everyone. `<Gather>` is used only
for keypad input (`input="dtmf"`).

zh/ko/ru/fr/tl prompts await a native-speaker pass, like the rest of the requester UI. The Arabic Chirp3-HD
voice name is from Twilio's voice table; the other voice names follow Google's naming and should be checked in
Console → Voice → Text-to-speech once an account exists (change any with `TWILIO_SAY_VOICES`).

## Privacy

- **Recordings are deleted at Twilio right after transcription** (`DELETE /Recordings/{RE…}.json`, 204), and also
  when the recording is empty or the caller hangs up mid-message (those are never transcribed). Each delete is in
  the audit log (`phone.recording_deleted`); a failed delete is logged as `phone.recording_delete_failed` so an
  operator can remove it in the Console.
- Our copy follows `AUDIO_RETENTION` like every voice note: `none` (default) wipes the bytes after transcription.
- The caller's number is stored on the request (`contact.phone`) for the call-back and for household caps. Logs
  mask it (`core.redactDeep`). The public report never shows it.
- TTS clips live in memory only, behind signed URLs that expire.
- Call-backs say the vetted template message (amount and wallet, never the handle). A call that reaches voicemail
  leaves that message.

## Abuse and limits

- **Signatures:** every webhook must carry a valid `X-Twilio-Signature` for our auth token, and its `AccountSid`
  must be ours. Otherwise 403. Validation follows twilio-node 5.x exactly (sorted params, with/without default
  port) and is pinned to Twilio's documented example and to vectors produced by the SDK.
- **Per caller:** 4 calls, then one more every 15 minutes; the whole line: 60 calls, then one every 10 s; with
  live AI each call also spends from the global AI budget (`security/rate-limit.ts`). `RATE_LIMITS=off` disables.
- **Per call:** 2 minutes per recording, 5 recordings, 10 minutes in total (`PHONE_MAX_CALL_SECONDS`), each keypad
  prompt repeated twice at most.
- **Withheld numbers** are refused by default (Twilio passes them as digit codes such as `266696687`).
- **Caller ID can be spoofed.** The number is a contact and a household key, never an identity: the request still
  needs two organizers, and the rail checks (lookalike handles, same destination under different names, velocity,
  caps) run on the payout destination too.
- **Prompt injection by voice** is the same as by text: the transcript goes through `core.checkRail`, and the
  intake agent has no tools. A request with hidden instructions or a lookalike handle is stopped at intake; the
  caller hears the neutral rail reply and no confirm prompt (tested).
- **Request ids in URLs** are only accepted from the number that created the request.

## Costs (Twilio US list prices, August 2026)

| Item | Price |
|---|---|
| Local number / toll-free number | $1.15 / $2.15 per month |
| Receive a call (local / toll-free) | $0.0085 / $0.022 per minute |
| Call-back (outbound, US & Canada) | $0.014 per minute |
| Call recording | $0.0025 per minute (storage is negligible: we delete it) |
| `<Say>` voices | Standard $0.0008, Neural $0.0032, Generative $0.013 per 100 characters |

A typical 3-minute call plus a 1-minute call-back costs about **$0.05–0.10** in Twilio fees, plus speech-to-text
and TTS from OpenAI.

## Limits of this version

- Call state (the "one moment" job, the call clock) lives in the web process, like the rate limiter. A restart
  mid-call means the caller hears "please call again"; the request and audit trail are in the database.
- Call-backs scheduled for after quiet hours are held in memory; the nightly unclaimed sweep re-notifies anyway.
- Declines are not phoned (only paid and claim-help); there is no appeal by phone yet.
- No answering-machine detection (it costs extra and adds delay); a voicemail gets the message.
- `/demo` does not include the phone line.

## Tests

```bash
pnpm --filter @neighborline/web exec vitest run lib/server/voice test/phone.test.ts
```

- `test/phone.test.ts`: full calls against the real engine with a simulated Twilio (`test/twilio-sim.ts`): Lan
  calls in Vietnamese → read-back → 1 → filed → two approvals → PayPal SUCCESS → call-back in Vietnamese; missing
  payout → second recording; press 2; keypad menu; Haitian Creole fallback; injection blocked; empty recording;
  hang-up; out-of-order callbacks; bad signatures; withheld numbers; rate limit; max call length; request
  ownership.
- `lib/server/voice/*.test.ts`: signature vectors, the REST client (Basic auth, SSRF guard, delete, 4000-character
  TwiML cap, SMS sender rule), the outbound adapter (idempotency, quiet hours, SMS rule, TTS clips), config.

## Sources (checked October 2026)

- Webhook security and signature algorithm: twilio.com/docs/usage/webhooks/webhooks-security
- `<Record>` attributes and callbacks: twilio.com/docs/voice/twiml/record
- `<Gather>` input, language, speech models: twilio.com/docs/voice/twiml/gather
- `<Say>` voices and pricing tiers: twilio.com/docs/voice/twiml/say/text-speech
- Recording resource (media download, DELETE → 204, Basic auth): twilio.com/docs/voice/api/recording
- Call resource (`Twiml` ≤ 4000 characters, `From` must be a Twilio number): twilio.com/docs/voice/api/call-resource
- Withheld caller ID values: support.twilio.com/hc/en-us/articles/223179988
- A2P 10DLC blocking: twilio.com/en-us/changelog (September 1, 2023); toll-free verification: support.twilio.com/hc/en-us/articles/20212966914075
- WhatsApp Sandbox: twilio.com/docs/whatsapp/sandbox
- Voice pricing: twilio.com/en-us/voice/pricing/us
