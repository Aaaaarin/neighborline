# Demo video pipeline (Draft 6: the storm, the demo, one warm window)

This folder turns `../VIDEO_SCRIPT.md` into a reviewable MP4 with one command. It follows `../RECORDING_PLAN.md`
and records the real product, so the cut never drifts from the app the judges will open.

```bash
node docs/submission/video/build.mjs            # captions, no VO (records takes only if missing)
node docs/submission/video/build.mjs --record   # re-record every take and still (UI copy changed)
node docs/submission/video/build.mjs --with-vo  # + OpenAI gpt-4o-mini-tts narration (key only for lines not in $VIDEO_OUT/vo)
node docs/submission/video/build.mjs --vo-jobs docs/submission/video/vo-jobs.json  # TTS jobs for CI (voiceover.yml)
node docs/submission/video/build.mjs --with-vo --vo-file narration.m4a  # your own narration → neighborline-final.mp4 (see below)
```

Other flags: `--rebuild-web` (fresh `next build` into `apps/web/.next-video`), `--fresh-tests` (re-run `pnpm test`
for code card 4), `--no-thumbnail`. Env: `VIDEO_OUT` (default `/home/claude/video-out`), `HOSTED_URL` (fills the end
card with `<HOSTED_URL>/demo`; until it is set the card says "Live demo link in the description"), `VIDEO_TAP_AT`
(when the recorder taps Approve as Marcus, seconds after Play, default 20.3), `VIDEO_WEB_PORT` /
`VIDEO_FAKE_PAYPAL_PORT` / `VIDEO_APPROVER_PORT` / `VIDEO_DEV_DB_PORT` (3500 / 4510 / 4520 / 4530).

The MCP beat uses `takes/mcp-demo.mp4`, which the examples lane records:
`pnpm --filter @neighborline/example-mcp-agent-demo record`. The build stops if it is missing.

A full run from nothing takes about 15 minutes: the build about 2, the three takes about 5, and the encode about 8.
With the takes cached, a re-cut takes about 12 minutes (the last pass, overlays and burned captions, is about 9 of
them); the first build of the drawn scenes adds about 9 more, after which they are reused.

## What it does

| Step | File | Output (outside git, in `$VIDEO_OUT`) |
|---|---|---|
| 1. Stack | `lib/servers.mjs` | dev-db, fake PayPal, approver and a production build of the web app on the video's own ports, with the same process layout as `apps/web/playwright.config.ts`. Each child runs in its own process group; only those groups are stopped (PIDs in `logs/servers.pids`). `next build` rewrites `apps/web/next-env.d.ts` and `tsconfig.json`; the script restores both byte for byte |
| 2. Takes | `lib/record.mjs` | `takes/{lan,rosa,blocked}.mp4` + `.markers.json`. DevTools screencast at 2880×1620 (a 1.5× viewport with `html{zoom:1.5}`, because the screencast ignores `deviceScaleFactor`; `VIDEO_DPR` overrides). Constant 30 fps by sampling the newest capture at each 1/30 s into a numbered symlink sequence (Draft 1 used the concat demuxer's per-image `duration`, which rounds to 1/25 s and stretched the takes by ~13 %, so its stopwatch ran slow on screen). Stage events come from `/api/stream?requestId=…` subscribed as the page's own visitor (the stream is viewer-scoped) and carry the server's own timestamps. **Lan is the manual take**: a virtual WebAuthn authenticator, "I’ll approve as Marcus" on, a tap ring and a real click at P+`VIDEO_TAP_AT`; the take fails unless the card says "Signed with passkey" |
| 2b. Cold open | `lib/voicenote.mjs` | `segs/s00.mp4`: Mrs. Lan's voice note as a card (waveform filling, her Vietnamese words lighting up, the English under them, the hook line at 0.3 s), rendered frame by frame. With `--with-vo` the waveform and word timing come from her generated voice file |
| 2c. Scenes | `lib/scene.mjs` | `segs/sA.mp4`, `sB`, `sC`, `s13`: the drawn shots (`kind: "scene"`). `street` (a night street of house silhouettes, every window dark, iced and downed lines, sleet, a slow push toward Mrs. Lan's house, her name and a 23 % battery), `help` (a six-page English form mock beside a comment thread that counts to 300), `line` (one sentence on near-black) and `payoff` (the same street, one window lit in `--lamp`, then the end card). HTML/SVG/canvas, the app's fonts, a cold palette; the only warm colour is that window. Rendered frame by frame, with animated grain added at the encode. `beats` in `timeline.json` are seconds into the shot. A finished segment is reused while its page and length are unchanged (`segs/<id>.mp4.key`). Preview one frame: `node docs/submission/video/lib/scene.mjs sB 11 /tmp/b.png` |
| 3. Stills | `lib/record.mjs` | `stills/{trust,report,rules}-full.png` (full page, DPR 2) and `anchors.json` (heading positions for the pans) |
| 4. Cards | `lib/cards.mjs` | The corner tag (light, and dark over the drawn scenes), lower thirds, the handle overlay, the code cards (Draft 6 shows cards 2 and 3), rendered from HTML with the app's Fontsource fonts and DESIGN.md tokens (`cards/_*.html` are the rendered sources). Code cards are cut from the committed files by regex anchors and fail loudly if an anchor moves, or if a card overflows into the caption band. Card 4 prints the real `pnpm -r test` summary (cached in `cache/pnpm-test.log`) |
| 5. Segments | `lib/segments.mjs` | One silent segment per shot (`segs/*.mp4`) in compositions A (one phone + big stopwatch), B (three phones + small stopwatch, plus timed insets such as Marcus's passkey signature at 1.6×), C (sender + Dana + 2× zoom of the blocked card), framed pans and pushes, cards, and full-frame clips (the MCP terminal) |
| 6. Captions | `lib/timeline.mjs`, `lib/captions.mjs` | `captions.srt` (also committed here, for YouTube CC) and `captions.ass` (burn-in; Be Vietnam Pro merged from the Fontsource subsets by `lib/fonts.py`, so Vietnamese diacritics render). Captions sit in the free right-hand column in compositions A and C and bottom-centre elsewhere, so they never cover the phones; over the drawn scenes they are light text on a dark box |
| 7. Assembly | `build.mjs` | Concat, then one pass for the corner tag, lower thirds, pills, overlays and burned captions → `neighborline-draft6.mp4` (`-vo-silent.mp4` under `--with-vo`) (H.264 High, yuv420p, 30 fps, silent AAC track) |
| 7b. Sound | `lib/sound.mjs` | Under `--with-vo`, when `timeline.json` has a `sound` block: the narration plus a bed synthesised with ffmpeg (nothing downloaded) → `neighborline-draft6-vo.mp4`. See "Sound" below |
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

Each VO line in `timeline.json` (`N1`–`N3` over the storm, then `V1` … `V10`, with `V5a–c` and `V7a`/`V7c` as the separately placed sub-lines; `V4` and `V7b` left with the title card and code card 1) has a
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
   phone-speaker EQ on Mrs. Lan's voice 0.2 s into her shot, and brings the mix to −14 LUFS / ≤ −1 dBTP → `neighborline-draft6-vo.mp4`.
4. Warns for any line longer than its window. Regenerate it brisker or move its window in `timeline.json`. Never
   speed up the Vietnamese voice: if hers runs past the cold open, lengthen shot `s00` and shift everything after it.
5. Cuts each line's captions at the pauses measured in its voice file (`pausesIn` in `lib/vo.mjs`; a full stop takes
   the longest pause near the estimate, a comma the nearest), so the cue on screen is the phrase being spoken.

Fitting a new render: measure where each line's *speech* ends (the last 50 ms window above −45 dB RMS, not the last
`silencedetect` start, which can be a mid-line pause), give every window at least the file's length − 0.2 s, and keep
0.4 s or more between a line's speech end and the next line's start. The mix is a plain `adelay` per line, so a line
that runs long overlaps the next one. A take shot may run up to 0.6 s past the end of its recording; `takeSegment`
holds the last frame (Shot 8 uses 0.4 s of that, on the finished blocked stage).

**Check what the TTS said, not only how long it is.** In the Draft 6 round `N3` came back without its last sentence
("She just says it."): 4.85 s of speech and 1.2 s of silence where 6.5 s was expected. The length check does not catch
that. A second run of the workflow rendered it whole. Transcribe new lines (any local speech-to-text will do) or
listen to them before fitting. The workflow re-renders every line and force-pushes `vo-lines`, so that branch no longer
matches the cached files for unchanged lines; `$VIDEO_OUT/vo` is what the cut uses.

## Recording the narration yourself (`--vo-file`): the final cut

Read the 15 narrator lines in timeline order (`N1 N2 N3 V1 V2 V3 V5a V5b V5c V6 V7a V7c V10 V8 V9`, texts in
`vo-jobs.json`) into one phone recording, with **2 s or more of silence between lines** and no pause longer than about
a second inside a line. Any of m4a, mp3, wav, ogg, webm. Then:

```bash
HOSTED_URL=neighborline.onrender.com VIDEO_OUT=/home/claude/video-out \
  node docs/submission/video/build.mjs --with-vo --vo-file /path/to/narration.m4a
```

→ `$VIDEO_OUT/neighborline-final.mp4` (the Draft 6 files are not touched). About 10 minutes with the scenes and takes
cached (9 min 25 s measured on 2 cores; the split and fit take the first 10 seconds); no API key (Mrs. Lan's voice note stays the cached AI file). Add `--vo-check` first to see the split and the fit
table in 10 seconds without rendering anything.

What `lib/human-vo.mjs` does:

1. **Clean**: 48 kHz mono, high-pass at 80 Hz, light FFT denoise at the measured room level, light compression.
2. **Split** at the silences. The threshold is set from the file itself (12 dB over its noise floor), the least gap is
   1.2 s. More segments than lines: it joins across the shortest silences if they are clearly the shortest. Fewer, or
   unclear: it stops and prints every segment (start, end, seconds, silence after, longest pause inside). Answer with
   `--vo-map`, 15 entries in line order: `3+4` joins two segments (a false start, a long breath), `6a,6b` cuts segment
   6 in two at its longest pause (two lines read without a break), a number left out is skipped (a cough, a retake).
3. **Trim and level**: 80 ms pads, one loudness for every line (−29 LUFS, what the TTS lines measure, so the bed and
   Mrs. Lan sit as in Draft 6; `VO_HUMAN_LUFS`).
4. **Fit**, printed as a table (speech seconds, window, fitted seconds, start, status). A line over its window is sped
   up without changing pitch, by at most 8 % (`--vo-max-tempo 1.08`). If it is still long it may use the gap after it,
   and then pushes the next line later, by at most 1.2 s. Lines never overlap each other or Mrs. Lan. If that cannot be
   done the build stops before rendering and names the lines to read again.
5. **Re-reading single lines**: put them in a folder as `<ID>.<ext>` (`V2.m4a`) and add `--vo-dir <folder>`; they
   replace those lines of the `--vo-file`. `--vo-dir` alone works too, with one file for each of the 15 lines.
6. The build rewrites the committed `captions.srt` (upload this one as the YouTube CC) and `edl.json`; commit both
   with the final cut.
7. Captions are cut at the pauses of the real voice, as for TTS. The corner tag reads `timeline.json →
   corner.textHumanVo` ("… · Mrs. Lan’s voice is AI"), and `edl.json` gets `narrator: "human"` and `voFit`.

Tested on Nov 12 with a synthetic recording (the 15 Draft 6 lines, 2.5 s apart, pink noise added, AAC): 15 segments,
every line within its window (V6 sped up 1.9 %), 176.5 s, no two voices closer than 0.34 s, mix −14.0 LUFS / −1.2 dBTP (`neighborline-final-TEST.mp4`). With one silence removed it stopped with the table of 14 segments, and `--vo-map` with `6a,6b` got it through. Limits: the split cannot tell what
was said, so listen to the result once: a retake left in, or two lines swapped, passes the fit check. `6a/6b` cuts at
the longest pause, which is not always the line break; check the lengths in the table. A long line that moves later is
also later against the picture (the anchored lines `V3` and `V5b` are timed to events on screen). Loud, changing
background noise (traffic, a fan starting) can hide the silences; the build warns when the voice is under 20 dB over
the room.

## Sound

`timeline.json → sound` and `lib/sound.mjs`. There is no music and nothing is downloaded: everything is ffmpeg noise
and sine sources.

- **Wind** under Act 1 (`sound.wind`): brown and pink noise, band-passed, with slow gusts and a faint drifting
  whistle, each channel from its own seed, over a quiet A drone. It fades out at the one-line beat, so her voice note
  starts in near-silence.
- **Pads** (`sound.pads`): a slow-attack A-major add9 chord of detuned sines, low-passed. One starts on the `SUCCESS`
  event of the Lan take (an `anchor`, like the lower thirds) and is the only sound in the tap-and-money silence; the
  other runs from the lamp in the close to the end.
- **Levels**: each element is gained to `belowVo` dB under the measured loudness of the narration, and the bed is
  ducked about 4 dB more while a line is spoken (a sidechain compressor keyed by the VO). The mix is then set to
  −14 LUFS with one static gain and a limiter. Single-pass `loudnorm` (Draft 5) would lift the bed in every pause.
  `edl.json → sound` records the measured loudness, true peak and each element's gain.
- If the pad sounds cheap, lower it or drop it from `sound.pads`; the wind is the part that carries the opening.

## Re-record when the neighbor's words change

The takes are screen captures of the running app, and `build.mjs` reuses `takes/*.mp4` when they exist. Any change
to text the stage phones show (the read-back, thread messages, their `EN` lines, the stage UI) makes the cached takes
stale: re-record with `--record`, then QA the frames that show the changed bubbles.

**Draft 4 (Oct 17) re-records every take for that reason.** Mrs. Lan calls herself *bà* and the volunteers *các
cháu*, so her read-back and notifications now use the elder register ("Dạ, chúng cháu hiểu như sau. Bà xem giúp…",
"Tin vui ạ: yêu cầu của bà đã được duyệt…", "Chào bà Lan ạ. Chúng cháu đã gửi $150 vào Venmo của bà…"); the `EN`
line under "approved, sending" now translates that same message ("Good news: your request was approved. We are
sending $150 to your Venmo now."); Rosa's claim help is gender-neutral Spanish. Draft 3's takes show the old text and
must not be reused. The thumbnail's stopwatch also fits the 1500×1000 card now (its last digit was clipped).
Draft 4 (`neighborline-draft4.mp4`, 160.5 s) is cut from the re-recorded takes: stopwatch 0:22.5 (people 0:18.9 ·
system 0:03.5), blocked 0:01.5, and a fresh `pnpm test` on code card 4 (1093 tests).

## Draft 6 (Nov 11): the story

`neighborline-draft6-vo.mp4`, 176.5 s. Feedback on Draft 5 was that it showed the product but not the disaster. Draft 6
puts a drawn Act 1 in front of the voice note (the dark street, the form and the comments, one line), keeps the Draft 5
footage as Act 2 with the title card and code cards 1 and 4 cut, and closes on the same street with one warm window
under the end card. New lines `N1`–`N3`, new text for `V1`, `V7c` and `V9`; the other nine files are Draft 5's. Shot 2
starts at P+4.8 (V1 is 4 s now) and the cut to her phone is 1.5 s earlier (P+24.7, "Paid," 1.4 s after `SUCCESS`).
The takes are Draft 4's; nothing was re-recorded. VIDEO_SCRIPT.md has the Draft 6 table.

## Draft 5 (Oct 29): voiced

`neighborline-draft5-vo.mp4`, 175.0 s: the 15 lines rendered by `.github/workflows/voiceover.yml` (branch `vo-lines`),
no line text changed, no line sped up. The real lines ran 0.2–3.4 s past Draft 4's estimated windows and Mrs. Lan's
voice note is 9.4 s, so `timeline.json` was retimed around them (cold open 10 s; Shots 5, 6, 7c, 8, 9, 11a–c, 12 and 13
re-sized; every VO window, lower third, pill, overlay and the corner tag's MCP gap moved with them). VIDEO_SCRIPT.md has
the Draft 5 shot table. Code card 4 reads the 1144-test run; the end card prints `neighborline.onrender.com/demo`.

## Known gaps

- (Fixed in Draft 5: the voiceover, and the hosted URL on the end card.)
- Nobody has listened to the Draft 6 mix: the levels were set by measurement on a machine without speakers. Listen
  once on headphones and once on a phone before uploading; `belowVo` in `timeline.json` is the knob.
- The drawn scenes are vector silhouettes. They read as intentional, but an illustrator would give the street more life.
- Approval 2's passkey is a virtual authenticator (labelled on screen). A human take on a Mac with Touch ID would
  read "Visitor’s Mac (as Marcus)".
- Everything still runs against the PayPal stand-in (`PAYPAL_MODE=fake`), labelled in the corner tag and the lower
  thirds. A real-sandbox beat (JUDGE-PANEL-2 #5c) needs credentials.
- Fixed Oct 17: the MCP example's organizers are Dana and Marcus and its handle is `@lan-nguyen54`, like the main
  story. The terminal take (`takes/mcp-demo.mp4`, 14.6 s) and `mcp-demo.png` were re-recorded, and Draft 3 (160.5 s) is cut from them with the 972-test code card.
