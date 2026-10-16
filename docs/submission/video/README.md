# Demo video pipeline (Draft 1: captions, no voiceover)

This folder turns `../VIDEO_SCRIPT.md` into a reviewable MP4 with one command. It follows `../RECORDING_PLAN.md`
and records the real product, so the cut never drifts from the app the judges will open.

```bash
node docs/submission/video/build.mjs            # Draft 1: captions, no VO (records takes only if missing)
node docs/submission/video/build.mjs --record   # re-record every take and still (UI copy changed)
node docs/submission/video/build.mjs --with-vo  # + OpenAI gpt-4o-mini-tts narration (needs OPENAI_API_KEY)
```

Other flags: `--rebuild-web` (fresh `next build` into `apps/web/.next-video`), `--fresh-tests` (re-run `pnpm -r test`
for code card 4), `--no-thumbnail`. Env: `VIDEO_OUT` (default `/home/claude/video-out`), `HOSTED_URL` (fills the end
card; until it is set the end card shows a red `HOSTED_URL` placeholder on purpose), `VIDEO_WEB_PORT` /
`VIDEO_FAKE_PAYPAL_PORT` / `VIDEO_APPROVER_PORT` / `VIDEO_DEV_DB_PORT` (3500 / 4510 / 4520 / 4530).

A full run from nothing takes about 15 minutes: the build about 2, the three takes about 5, and the encode about 8.
With the takes cached, a re-cut takes about 8 minutes.

## What it does

| Step | File | Output (outside git, in `$VIDEO_OUT`) |
|---|---|---|
| 1. Stack | `lib/servers.mjs` | dev-db, fake PayPal, approver and a production build of the web app on the video's own ports, with the same process layout as `apps/web/playwright.config.ts`. Each child runs in its own process group; only those groups are stopped (PIDs in `logs/servers.pids`). `next build` rewrites `apps/web/next-env.d.ts` and `tsconfig.json`; the script restores both byte for byte |
| 2. Takes | `lib/record.mjs` | `takes/{lan,rosa,blocked}.mp4` + `.markers.json`. DevTools screencast at 2880×1620 (a 1.5× viewport with `html{zoom:1.5}`, because the screencast ignores `deviceScaleFactor`; 1.5× keeps ~15 fps, 2× drops to ~8 fps; `VIDEO_DPR` overrides). Constant 30 fps rebuilt from the frame timestamps. Every stage event is timestamped from the app's own `/api/stream` SSE on the same clock, so the markers are exact without a sync flash |
| 3. Stills | `lib/record.mjs` | `stills/{trust,report,rules}-full.png` (full page, DPR 2) and `anchors.json` (heading positions for the pans) |
| 4. Cards | `lib/cards.mjs` | Title, end card, corner tag, lower thirds, the handle overlay, 4 code cards, rendered from HTML with the app's Fontsource fonts and DESIGN.md tokens (`cards/_*.html` are the rendered sources). Code cards are cut from the committed files by regex anchors and fail loudly if an anchor moves, or if a card overflows into the caption band. Card 4 prints the real `pnpm -r test` summary (cached in `cache/pnpm-test.log`) |
| 5. Segments | `lib/segments.mjs` | One silent segment per shot (`segs/*.mp4`) in compositions A (one phone + big stopwatch), B (three phones + small stopwatch), C (sender + Dana + 2× zoom of the blocked card), framed pans and pushes, cards |
| 6. Captions | `lib/timeline.mjs`, `lib/captions.mjs` | `captions.srt` (also committed here, for YouTube CC) and `captions.ass` (burn-in; Be Vietnam Pro merged from the Fontsource subsets by `lib/fonts.py`, so Vietnamese diacritics render). Captions sit in the free right-hand column in compositions A and C and bottom-centre elsewhere, so they never cover the phones |
| 7. Assembly | `build.mjs` | Concat, then one pass for the corner tag, lower thirds, pills, overlays and burned captions → `neighborline-draft1.mp4` (H.264 High, yuv420p, 30 fps, silent AAC track) |
| 8. QA | `lib/qa.mjs`, `lib/thumbnail.mjs` | `frames/s_<shot>_in.png` / `_out.png` at every cut, `frames/f_<n>s.png` every 10 s, `frames/contact.png`, plus `thumbnail.png` (1280×720), `thumbnail-1500x1000.png` and the 300 / 168 px legibility checks |

`timeline.json` is the edit decision list you change by hand: shots with script timecodes, VO lines with their
windows and target words per minute, lower thirds, pills and overlays. A source point `P+x` means x seconds after the
Play click in that take. An `anchor: {take, event, offset}` resolves to the video time at which a stage event
(`confirmed`, `approval1`, `approval2`, `unclaimed`, `success`, `flagged`, …) is on screen, so captions like
"Approval 2 of 2" land on the real event, not on the script's guess. `{T}`, `{T_words}` and `{BLOCK_T}` are filled
from the recorded stopwatch.

`edl.json` is written on every build. It holds the resolved timecodes, the stopwatch values, each take's event times,
the VO fit per line and the test counts. Review it together with the MP4.

## Where the voiceover goes

Each VO line in `timeline.json` (`V1` … `V9`, with `V5a–d` and `V7a–c` as the separately placed sub-lines) has a
`start`, an `end` (its window) and a `wpm`. In Draft 1 the burned captions run for the *estimated* spoken length
(words ÷ wpm) from `start`. `edl.json → vo[]` lists every line with `estSeconds`, `window`, `fits` and `needWpm`, and
the build prints a `VO fit:` warning for each line that cannot be read at its wpm inside its window.

`--with-vo` (`lib/vo.mjs`):
1. Generates each line with `gpt-4o-mini-tts` (narrator voice `coral`, override with `VO_VOICE`) and Mrs. Lan's
   Vietnamese voice note (`sage`, `VO_LAN_VOICE`). Files are cached in `$VIDEO_OUT/vo/` by a hash of the text, voice
   and instructions, so only changed lines cost money.
2. Re-times the captions to the measured length of each line.
3. Places every line at its `start` with `adelay`, puts a phone-speaker EQ on Mrs. Lan's voice at 0:00.2, and
   normalises to −14 LUFS / −1 dBTP → `neighborline-draft-vo.mp4`.
4. Warns for any line longer than its window. Regenerate it brisker or move its window in `timeline.json`. Never
   speed up the Vietnamese voice.

Music is not part of the pipeline. If you add a bed, follow RECORDING_PLAN.md step 8 (duck under VO, silent 0:24–0:33).

## Known gaps in Draft 1

- The end card shows `HOSTED_URL` in red until the app is deployed and `HOSTED_URL` is exported.
- `/organizer/rules` (the rules editor) is captured as a still (`stills/rules-full.png`) but is not in the script's
  shot list. The natural slot is under V2 ("The group's own rules, not the AI, set the amount").
- The script's on-screen translations under the bubbles (Shots 5 and 7) are not added. The phones already show the
  app's own `EN` translation under every Vietnamese and Spanish bubble.
