# Demo video pipeline (Draft 2: captions, no voiceover yet)

This folder turns `../VIDEO_SCRIPT.md` into a reviewable MP4 with one command. It follows `../RECORDING_PLAN.md`
and records the real product, so the cut never drifts from the app the judges will open.

```bash
node docs/submission/video/build.mjs            # Draft 2: captions, no VO (records takes only if missing)
node docs/submission/video/build.mjs --record   # re-record every take and still (UI copy changed)
node docs/submission/video/build.mjs --with-vo  # + OpenAI gpt-4o-mini-tts narration (needs OPENAI_API_KEY)
```

Other flags: `--rebuild-web` (fresh `next build` into `apps/web/.next-video`), `--fresh-tests` (re-run `pnpm test`
for code card 4), `--no-thumbnail`. Env: `VIDEO_OUT` (default `/home/claude/video-out`), `HOSTED_URL` (fills the end
card with `<HOSTED_URL>/demo`; until it is set the card says "Live demo link in the description"), `VIDEO_TAP_AT`
(when the recorder taps Approve as Marcus, seconds after Play, default 20.3), `VIDEO_WEB_PORT` /
`VIDEO_FAKE_PAYPAL_PORT` / `VIDEO_APPROVER_PORT` / `VIDEO_DEV_DB_PORT` (3500 / 4510 / 4520 / 4530).

The MCP beat uses `takes/mcp-demo.mp4`, which the examples lane records:
`pnpm --filter @neighborline/example-mcp-agent-demo record`. The build stops if it is missing.

A full run from nothing takes about 15 minutes: the build about 2, the three takes about 5, and the encode about 8.
With the takes cached, a re-cut takes about 8 minutes.

## What it does

| Step | File | Output (outside git, in `$VIDEO_OUT`) |
|---|---|---|
| 1. Stack | `lib/servers.mjs` | dev-db, fake PayPal, approver and a production build of the web app on the video's own ports, with the same process layout as `apps/web/playwright.config.ts`. Each child runs in its own process group; only those groups are stopped (PIDs in `logs/servers.pids`). `next build` rewrites `apps/web/next-env.d.ts` and `tsconfig.json`; the script restores both byte for byte |
| 2. Takes | `lib/record.mjs` | `takes/{lan,rosa,blocked}.mp4` + `.markers.json`. DevTools screencast at 2880×1620 (a 1.5× viewport with `html{zoom:1.5}`, because the screencast ignores `deviceScaleFactor`; `VIDEO_DPR` overrides). Constant 30 fps by sampling the newest capture at each 1/30 s into a numbered symlink sequence (Draft 1 used the concat demuxer's per-image `duration`, which rounds to 1/25 s and stretched the takes by ~13 %, so its stopwatch ran slow on screen). Stage events come from `/api/stream?requestId=…` subscribed as the page's own visitor (the stream is viewer-scoped) and carry the server's own timestamps. **Lan is the manual take**: a virtual WebAuthn authenticator, "I’ll approve as Marcus" on, a tap ring and a real click at P+`VIDEO_TAP_AT`; the take fails unless the card says "Signed with passkey" |
| 2b. Cold open | `lib/voicenote.mjs` | `segs/s00.mp4`: Mrs. Lan's voice note as a card (waveform filling, her Vietnamese words lighting up, the English under them, the hook line at 0.3 s), rendered frame by frame. With `--with-vo` the waveform and word timing come from her generated voice file |
| 3. Stills | `lib/record.mjs` | `stills/{trust,report,rules}-full.png` (full page, DPR 2) and `anchors.json` (heading positions for the pans) |
| 4. Cards | `lib/cards.mjs` | Title, end card, corner tag, lower thirds, the handle overlay, 4 code cards, rendered from HTML with the app's Fontsource fonts and DESIGN.md tokens (`cards/_*.html` are the rendered sources). Code cards are cut from the committed files by regex anchors and fail loudly if an anchor moves, or if a card overflows into the caption band. Card 4 prints the real `pnpm -r test` summary (cached in `cache/pnpm-test.log`) |
| 5. Segments | `lib/segments.mjs` | One silent segment per shot (`segs/*.mp4`) in compositions A (one phone + big stopwatch), B (three phones + small stopwatch, plus timed insets such as Marcus's passkey signature at 1.6×), C (sender + Dana + 2× zoom of the blocked card), framed pans and pushes, cards, and full-frame clips (the MCP terminal) |
| 6. Captions | `lib/timeline.mjs`, `lib/captions.mjs` | `captions.srt` (also committed here, for YouTube CC) and `captions.ass` (burn-in; Be Vietnam Pro merged from the Fontsource subsets by `lib/fonts.py`, so Vietnamese diacritics render). Captions sit in the free right-hand column in compositions A and C and bottom-centre elsewhere, so they never cover the phones |
| 7. Assembly | `build.mjs` | Concat, then one pass for the corner tag, lower thirds, pills, overlays and burned captions → `neighborline-draft2.mp4` (H.264 High, yuv420p, 30 fps, silent AAC track) |
| 8. QA | `lib/qa.mjs`, `lib/thumbnail.mjs` | `frames/s_<shot>_in.png` / `_out.png` at every cut, `frames/f_<n>s.png` every 10 s, `frames/contact.png`, plus `thumbnail.png` (1280×720), `thumbnail-1500x1000.png` and the 300 / 168 px legibility checks |

`timeline.json` is the edit decision list you change by hand: shots with script timecodes, VO lines with their
windows and target words per minute, lower thirds, pills and overlays. A source point `P+x` means x seconds after the
Play click in that take (for the MCP clip, seconds into the terminal recording). An `anchor: {take, event, offset}` resolves to the video time at which a stage event
(`confirmed`, `approval1`, `approval2`, `unclaimed`, `success`, `flagged`, …) is on screen, so captions like
"Approval 2 of 2" land on the real event, not on the script's guess. `{T}`, `{T_words}` and `{BLOCK_T}` are filled
from the recorded stopwatch, `{TESTS}` from the real test run.

`edl.json` is written on every build. It holds the resolved timecodes, the stopwatch values, each take's event times,
the VO fit per line and the test counts. Review it together with the MP4.

## Where the voiceover goes

Each VO line in `timeline.json` (`V1` … `V10`, with `V5a–c` and `V7a–c` as the separately placed sub-lines) has a
`start`, an `end` (its window) and a `wpm`. In Draft 1 the burned captions run for the *estimated* spoken length
(words ÷ wpm) from `start`. `edl.json → vo[]` lists every line with `estSeconds`, `window`, `fits` and `needWpm`, and
the build prints a `VO fit:` warning for each line that cannot be read at its wpm inside its window.

`--with-vo` (`lib/vo.mjs`):
1. Generates each line with `gpt-4o-mini-tts` (narrator voice `coral`, override with `VO_VOICE`) and Mrs. Lan's
   Vietnamese voice note (`sage`, `VO_LAN_VOICE`; the text is the cold-open shot's `voice.vi` in `timeline.json`, the
   first two sentences of the intake fixture). Files are cached in `$VIDEO_OUT/vo/` by a hash of the text, voice
   and instructions, so only changed lines cost money.
2. Re-times the captions to the measured length of each line.
3. Re-renders the cold open with her real waveform, places every line at its `start` with `adelay`, puts a
   phone-speaker EQ on Mrs. Lan's voice at 0:00.2, and normalises to −14 LUFS / −1 dBTP → `neighborline-draft2-vo.mp4`.
4. Warns for any line longer than its window. Regenerate it brisker or move its window in `timeline.json`. Never
   speed up the Vietnamese voice: if hers runs past 4.8 s, lengthen shot `s00` and shift everything after it.

Music is not part of the pipeline. If you add a bed, follow RECORDING_PLAN.md step 8 (duck under VO, silent 0:25–0:31.5,
the tap and the money moment).

## Known gaps in Draft 2

- No voiceover yet (no `OPENAI_API_KEY` in the build environment). Every line fits its slot at ≤ 154 wpm, so
  `--with-vo` should drop in without retiming; check the `WARNING` lines it prints.
- The end card says "Live demo link in the description" until the app is deployed and `HOSTED_URL` is exported.
- Approval 2's passkey is a virtual authenticator (labelled on screen). A human take on a Mac with Touch ID would
  read "Visitor’s Mac (as Marcus)".
- Everything still runs against the PayPal stand-in (`PAYPAL_MODE=fake`), labelled in the corner tag and the lower
  thirds. A real-sandbox beat (JUDGE-PANEL-2 #5c) needs credentials.
- Fixed Oct 17: the MCP example's organizers are Dana and Marcus and its handle is `@lan-nguyen54`, like the main
  story. The terminal take (`takes/mcp-demo.mp4`, 14.6 s) and `mcp-demo.png` were re-recorded; re-render the cut.
