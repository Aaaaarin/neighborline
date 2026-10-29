# YouTube upload: paste-ready

The rules require the video to be **under 3 minutes** and **publicly visible on YouTube**, with no third-party
trademarks and no copyrighted music. Upload the **voiced** cut (`neighborline-draft4-vo.mp4` from
`node docs/submission/video/build.mjs --with-vo`, or the final cut that replaces it), not the caption-only
`neighborline-draft4.mp4`. Times below are from `video/edl.json` (Draft 4, 2:40.5); re-check them if the cut changes.

## File, thumbnail, captions

| Field | Value |
|---|---|
| Video file | `/home/claude/video-out/neighborline-draft4-vo.mp4` (2:40.5, 1920×1080, 30 fps) |
| Custom thumbnail (16:9, ≤ 2 MB) | `/home/claude/video-out/thumbnail.png` (1280×720, 288 KB) |
| Subtitles / CC | Upload [`video/captions.srt`](video/captions.srt) as **English** (Subtitles → Add language → English → Upload file → *With timing*). The cut also has burned-in captions; the SRT makes them searchable and lets viewers resize them |
| Video language | English |
| Caption certification | "This content has never aired on television in the U.S." |

## Title (≤ 100 characters)

```
Neighborline: a voice note in any language becomes PayPal or Venmo cash, approved by two neighbors
```

98 characters. Shorter alternate (74): `Neighborline: voice note → PayPal or Venmo cash, approved by two neighbors`.

## Description

```
Mrs. Lan doesn't read English, and her power has been out for two days. She leaves a voice note in Vietnamese. Twenty-two seconds later, $150 is in her Venmo and a message comes back in Vietnamese.

Neighborline is a mutual-aid hotline for neighborhood groups, built for the PayPal AI Hackathon. A neighbor asks for help in any of 10 languages; AI transcribes it, translates it and reads it back in their language; code computes the amount from the group's own written rules; two organizers approve with passkeys on their phones; and a separate approval service pays through PayPal Payouts to PayPal or Venmo. The AI never decides who deserves help and never touches the money.

▶ Try it, no login: https://neighborline.onrender.com/demo
▶ Source (MIT): https://github.com/Aaaaarin/neighborline
▶ How it was tested and what is simulated: https://github.com/Aaaaarin/neighborline#sandbox-reality

Chapters
0:00 Mrs. Lan's voice note becomes Venmo cash
0:44 Why: a hotline, not a dashboard
0:57 Unclaimed payout, rescued in Spanish
1:21 Impersonator blocked, and who can move money
1:45 Under the hood: schema repair, idempotent batches, verified webhooks
2:05 An AI agent can pay only with two humans' signatures (MCP)
2:17 Where the money went, and how to try it

What you are seeing
• Everything runs on the real engine (web app, separate approval service, database). PayPal is our local stand-in that mirrors PayPal's documented sandbox API ("Simulated PayPal sandbox" on screen). {AFTER THE SANDBOX RUN: "PayPal calls go to PayPal's sandbox; Rosa's claim is simulated."}
• No real money moves. All people, handles and the group are fictional.
• The organizers' taps come on cue. Approval 2 is a real click and a real WebAuthn passkey ceremony on a virtual authenticator in Chrome; Dana signs with a labelled demo key.
• Rosa's segment is shown at 2× speed, and her claim is played by the PayPal stand-in.
• The AI agent in the MCP segment is scripted (no model call) against the real MCP server.
• The donor report uses seeded demo data.
• Voices are synthetic: Mrs. Lan, Rosa and the narrator are AI text-to-speech (OpenAI gpt-4o-mini-tts). They are not real people.

Sources for the numbers
• 300 requests overnight after the Eaton fire: LA Public Press, Jan 2025 — https://lapublicpress.org/2025/01/altadena-pasadena-mutual-aid-la-fires-eaton/
• Venmo handles spoofed one letter off: Chronicle of Philanthropy, Apr 2026 — https://www.philanthropy.com/solutions/scammers-are-spoofing-charities-on-venmo-how-to-protect-your-donors/
• About 900 active US mutual-aid groups mapped by 2021: Mutual Aid Hub, via Spotlight on Poverty — https://spotlightonpoverty.org/spotlight-exclusives/mutual-aid-hub-helping-community-members-help-each-other

Credits
Built with Claude Code (Anthropic). AI in the product: Anthropic Claude and OpenAI (speech-to-text, text-to-speech). Fonts: Literata, Be Vietnam Pro, Atkinson Hyperlegible Mono (SIL Open Font License). {MUSIC: "No music." or "Music: <track> by <artist>, YouTube Audio Library (no attribution required)"}
PayPal and Venmo are trademarks of PayPal, Inc. This is an independent hackathon project, not affiliated with or endorsed by PayPal.

#PayPal #MutualAid #AI
```

Notes:
- **Chapters**: YouTube needs the first at `0:00`, at least three, each at least 10 s long. The script's shots at
  0:05, 0:14 and 0:31 (and the 9-second impersonator shot at 1:21) are folded into their neighbors for that reason.
- If `{HOSTED_URL}` doesn't exist at upload time, replace the first ▶ line with
  `▶ Run it locally with zero credentials: corepack enable && pnpm i && pnpm dev` and edit the description later
  (the end card already says "Live demo link in the description").
- The trademark line is a courtesy; the rules forbid trademark *logos* in the video, which the cut avoids.

## Tags

```
Neighborline, PayPal, PayPal Payouts, Venmo, mutual aid, disaster relief, AI agents, MCP, Model Context Protocol, passkeys, WebAuthn, multilingual, voice note, speech to text, Claude, OpenAI, Next.js, TypeScript, hackathon, PayPal AI Hackathon, Devpost, open source
```

(265 of YouTube's 500 characters.)

## Settings

| Setting | Value |
|---|---|
| Visibility | **Public** (the rules say "publicly visible"; unlisted is a risk) |
| Audience | No, it's not made for kids |
| Category | Science & Technology |
| License | Standard YouTube License (or Creative Commons – Attribution, if you want others to reuse it) |
| Comments | On (judges may ask questions); hold potentially inappropriate comments for review |
| Allow embedding | On (Devpost embeds the player) |
| Paid promotion | No |
| Recording date / location | Oct 17, 2026 / leave empty |

## "Altered or synthetic content" (YouTube Studio → Details → Altered content)

YouTube asks whether the video "makes a real person appear to say or do something they didn't", "alters footage of
a real event or place", or "generates a realistic-looking scene that didn't actually occur".

**Answer: Yes.** The voices of Mrs. Lan and Rosa are realistic synthetic speech of fictional people, telling a
realistic story (an ice storm, a request for help) that did not happen. No real person is depicted or imitated, and no
real event is altered, but a viewer could mistake her voice note for a real one, which is exactly what the disclosure
is for. The video also discloses it on screen (corner tag "AI voices") and in the description. Ticking "Yes" adds
YouTube's "Altered or synthetic content" label to the description panel; that is fine and consistent with our
"say what is simulated" story.

## After upload

1. Open the video logged out (private window): it plays, the captions load, the length shows under 3:00.
2. Put `{VIDEO_ID}` into DEVPOST_FIELDS.md §7 and the README (`Video:` link), and the hosted URL into the description.
3. Pin a comment with the demo link and "Questions welcome."
