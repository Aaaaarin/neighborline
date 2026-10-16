# Recording plan: an agent builds the video with no human

This plan turns `VIDEO_SCRIPT.md` into `neighborline-demo.mp4` (1920×1080, 30 fps, about 2:45) using only tools
already in this environment:
- Playwright 1.56 with Chromium (`/opt/pw-browsers`)
- ffmpeg 6.1, which has `libass`, `drawtext`, `zoompan`, `xfade`, `sidechaincompress` and `loudnorm`
- Python 3 with fontTools
- OpenAI TTS (`gpt-4o-mini-tts`), once `OPENAI_API_KEY` exists

A human is needed for only two steps: the YouTube upload (it needs an OAuth login) and, ideally, a native-speaker
check of the Vietnamese and Spanish text.

```
video-build/                      # working dir (scratchpad or tools/video/; do not commit renders)
  takes/       lan.webm rosa.webm blocked.webm + *.markers.json      ← step 2
  stills/      trust-full.png report-full.png stage-end.png           ← step 3
  cards/       title.png end.png lt-*.png code-*.png corner.png       ← step 4
  vo/          V1.wav … V9.wav  lan_voice.wav                         ← step 5
  captions.srt                                                        ← step 6
  segs/        s01.mp4 … s13.mp4                                      ← step 7
  neighborline-demo.mp4                                               ← step 8
```

---

## Step 0. Preflight (2 minutes, do it first)

```bash
cd /home/claude/neighborline
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
pnpm install
# Pick the mode. The web app always runs the real engine; use sandbox only after the real-sandbox spike passed
# (README "Sandbox reality"). In fake mode use the 'simulated' labels. The engine also needs dev-db, fake PayPal and
# the approver: docs/submission/video/build.mjs starts all four on its own ports (see video/README.md).
PAYPAL_MODE=${PAYPAL_MODE:-fake} AI_MODE=${AI_MODE:-fixture} DEMO_MODE=true \
  pnpm --filter @neighborline/web build && \
  (PORT=3100 pnpm --filter @neighborline/web exec next start -p 3100 > /tmp/web.log 2>&1 &)
npx wait-on http://localhost:3100/demo          # or: until curl -sf localhost:3100/demo >/dev/null; do sleep 1; done
# No reset needed: each fresh browser context is a new visitor with its own runs (/api/demo/reset is not public).
```

**Sharpness test.** Before recording the real takes, check whether Playwright's recorder delivers true 2× pixels:

```bash
node video-build/record.mjs --probe     # records 3 s of /demo at DPR 2 into a 3840×2160 video
ffprobe -v error -show_entries stream=width,height -of csv=p=0 video-build/takes/probe.webm
ffmpeg -y -ss 2 -i video-build/takes/probe.webm -frames:v 1 -vf "crop=900:500:2640:184" video-build/probe-crop.png
```

Read `probe-crop.png`. The stopwatch digits must be crisp, not soft.
- If they are crisp, keep `deviceScaleFactor: 2` with a 3840×2160 `recordVideo.size`. All crop boxes below are in these 2× source pixels.
- If they are soft (the recorder captured at CSS resolution and upscaled), use the **CDP screencast fallback** in the box at the end of step 2. It captures true device pixels.
- The last resort is DPR 1 at 1920×1080. Halve every crop box; the phone close-ups are then upscaled about 1.15×, which is acceptable.

---

## Step 1. The timing we can rely on

Every stage take runs the real engine through `apps/web/lib/server/engine/scenario-runner.ts`; only the human beats
are scripted (`BEATS`: note arrives 1.5 s, listening 7 s, each organizer's look 6 s, claim 12 s, all divided by
`speed`). Times below are from `request.created` (stage t0), measured Oct 16, 2026 from `/api/stream` on a production
build in fake mode. The pipeline re-measures them from each take's markers, so treat these as a guide.

| Scenario (speed) | Transcribed + read-back | Confirmed | Approval 1 | Approval 2 + batch | UNCLAIMED | SUCCESS (clock stops) | Message back |
|---|---|---|---|---|---|---|---|
| `lan` (1) | 1.6 s | 8.6 s | 14.7 s | 20.8 s / 21.0 s | – | 22.5 s | 22.5 s |
| `rosa` (2) | 0.8 s | 4.3 s | 7.4 s | 10.5 s / 10.6 s | 12.1 s | 18.2 s | 12.1 s (claim help), 18.2 s (paid) |
| `blocked` (1) | 1.2 s | – | – | – | – | flagged 1.2 s (clock stops) | 1.2 s |

The script places stage t0 at **video 0:02** (Lan), **1:00** (Rosa) and **1:27.5** (impersonator).

---

## Step 2. Record the stage takes (Playwright)

`video-build/record.mjs`, abridged but complete in logic:

```js
// node video-build/record.mjs [--probe] [--only=lan,rosa,blocked]
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = new URL('./takes/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const TAKES = {
  lan:     { url: '/demo?scenario=lan&speed=1',     done: /Stopped at the verified SUCCESS webhook/, tail: 16_000 },
  rosa:    { url: '/demo?scenario=rosa&speed=2',    done: /Stopped at the verified SUCCESS webhook/, tail: 10_000 },
  blocked: { url: '/demo?scenario=blocked&speed=1', done: /blocked before any money moved/,        tail: 8_000 },
};
const HIDE = `::-webkit-scrollbar{display:none} *{caret-color:transparent!important} html{scrollbar-width:none}`;

const browser = await chromium.launch({ args: ['--lang=en-US', '--disable-features=Translate', '--hide-scrollbars'] });
for (const [id, t] of Object.entries(TAKES)) {
  // no reset: a new browser context is a new visitor, with its own runs
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'en-US',
    reducedMotion: 'no-preference',
    recordVideo: { dir: OUT, size: { width: 3840, height: 2160 } },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  // Sync flash: black, then a white frame at a known wall time. Later we find it in the video (see sync.py).
  await page.setContent('<body style="margin:0;background:#000;height:100vh"></body>');
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.body.style.background = '#fff'));
  const tFlash = Date.now() - t0;
  await page.waitForTimeout(400);
  await page.goto(BASE + t.url, { waitUntil: 'load' });
  await page.addStyleTag({ content: HIDE });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);                                        // clean idle frames for the cold open
  const tPlay = Date.now() - t0;
  await page.getByRole('button', { name: /play scenario/i }).click();
  await page.getByText(t.done).waitFor({ timeout: 90_000 });
  const tDone = Date.now() - t0;
  // The large stopwatch is the last visible role="timer" (the small one is in the <lg tab bar, hidden at 1920).
  const clock = await page.getByRole('timer').last().innerText();     // e.g. "0:22.5"
  await page.waitForTimeout(t.tail);                                      // hold on the final state
  writeFileSync(`${OUT}${id}.markers.json`, JSON.stringify({ tFlash, tPlay, tDone, clock }, null, 2));
  const video = page.video();
  await ctx.close();                                                      // finalizes the .webm
  renameSync(await video.path(), `${OUT}${id}.webm`);
}
await browser.close();
```

**Sync.** Find the first white frame. Its video time minus `tFlash/1000` is the offset to add to every marker:

```bash
ffmpeg -i takes/lan.webm -vf "fps=30,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -an -f null - 2>/dev/null \
 | awk '/pts_time/{t=$0} /YAVG/{split($0,a,"=");if(a[2]>200){print t;exit}}'
```

`sync.py` does exactly this and writes `takes/<id>.sync.json` with `{ "playAt": <video seconds of the Play click> }`.
Stage t0 is about 50–150 ms after the click, because `request.created` is emitted on the server; that is close enough
for this edit.

Record the stopwatch value (`clock` in the markers, e.g. `0:22.5`). Put it into `{T}` in VO line V3, the 0:33 lower
third and the thumbnail before generating TTS.

> **CDP screencast fallback** (only if step 0 failed): open a CDP session (`ctx.newCDPSession(page)`), call
> `Page.startScreencast({ format: 'jpeg', quality: 92, maxWidth: 3840, maxHeight: 2160, everyNthFrame: 1 })`,
> write each `Page.screencastFrame` to `frames/%06d.jpg` with its `metadata.timestamp`, and ack each frame. Then build
> a constant-rate video with the concat demuxer (one `duration` line per frame from the timestamp deltas) and
> `-vf fps=30`.

### Optional take: a human-looking second approval
`/demo?scenario=lan&mode=manual&speed=1`. The recorder waits for "Your turn", moves the mouse slowly
(`page.mouse.move(x, y, { steps: 25 })`) and clicks "Approve $150" on Marcus's phone. Use it only if you want a
visible tap. The default script does not need it.

---

## Step 3. Stills for pans (trust, report, stage end)

```bash
node apps/web/scripts/shot.mjs /trust  1920x1080 video-build/stills/trust-full.png  --full --dpr=2
node apps/web/scripts/shot.mjs /report 1920x1080 video-build/stills/report-full.png --full --dpr=2
# stage-end: last frame of the Lan take (full stage, rail visible)
ffmpeg -y -sseof -1 -i video-build/takes/lan.webm -frames:v 1 video-build/stills/stage-end.png
```

`shot.mjs` already supports `--full` and `--dpr` (BASE_URL=http://localhost:3100).

Pan a tall still with an ffmpeg crop window whose `y` depends on `t`. For example, the trust page's "Know your agent"
section, which in 2× pixels starts near y≈1950 (find it with `page.locator('h2', { hasText: 'Know your agent' }).boundingBox()`):

```bash
ffmpeg -y -loop 1 -t 10 -i stills/trust-full.png -vf \
 "crop=3840:2160:0:'1900+t*45',scale=1920:1080,fps=30,format=yuv420p" -c:v libx264 -crf 16 segs/s09.mp4
```

---

## Step 4. Cards rendered from HTML (title, end card, lower thirds, code, corner tag)

One small Node script (`cards.mjs`) writes HTML strings and screenshots them at 1920×1080, DPR 1, using the product's
own fonts from `apps/web/node_modules/@fontsource*` (`file://` CSS) and the DESIGN.md tokens:
- background `#EFF1EE`, ink `#18202E`, ink-3 `#5F6877`, lamp `#F4B33D`, frost `#D6E2EA`
- Literata for display, Be Vietnam Pro for UI, Atkinson Hyperlegible Mono for code and ids

```js
const css = (p) => `file://${createRequire(import.meta.url).resolve(p)}`;
const FONTS = ['@fontsource-variable/literata/index.css', '@fontsource/be-vietnam-pro/400.css',
  '@fontsource/be-vietnam-pro/600.css', '@fontsource-variable/atkinson-hyperlegible-mono/index.css']
  .map((p) => `<link rel="stylesheet" href="${css(p)}">`).join('');
async function card(name, body, { transparent = false } = {}) {
  await page.setContent(`<!doctype html><html><head>${FONTS}<style>${BASE_CSS}</style></head><body${transparent ? ' class="t"' : ''}>${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `cards/${name}.png`, omitBackground: transparent });
}
```

| File | Content | Alpha |
|---|---|---|
| `title.png` | Wordmark + "A hotline, not a dashboard." + 2 stat lines with sources (Shot 6) | no |
| `end.png` | End card (Shot 13). The right half only, so it composites next to Lan's phone | yes |
| `corner.png` | `PayPal sandbox · test money · fictional people · AI voices` pill, top-left | yes |
| `lt-01.png` … `lt-10.png` | Every lower third in VIDEO_SCRIPT.md, bottom-left, Be Vietnam Pro 26 px on a `--paper-raised` sheet with a `--rule` hairline (no shadow) | yes |
| `ov-handles.png` | The two stacked handles for Shot 8, mono 40 px, `@eastside-mutuaiaid` in `--signal` | yes |
| `code-1.png` … `code-4.png` | Code cards: read the file with `fs`, slice the line range, HTML-escape it, render mono 22 px with line numbers. Highlighted range on `--frost`; header `path:lines` in ink-3 | no |

The code cards are generated from the repo **at render time**, so they always match the committed code. Before
rendering, check that the line ranges still contain the expected strings (`senderBatchIdFor`,
`verify-webhook-signature`, `repair`, `export function reconcile`) with `grep -n`, and fail loudly if any is missing.

The terminal card (`code-4.png`) is a screenshot of the real `pnpm test` output: run
`pnpm -r test 2>&1 | grep -E "Test Files|Tests "` and render those lines verbatim. Never type the numbers by hand.

---

## Step 5. Voiceover with TTS

The lines are VIDEO_SCRIPT.md §2, V1–V9, after `{T}` is filled. Store them in `vo.json` as `[{ "id": "V1", "text": "…" }]`.

```bash
mkdir -p vo
NARRATOR_INSTR="Warm, calm, unhurried narrator. Plain American English. Like a neighbor explaining something at a kitchen table. No announcer energy. Slight pause at commas and periods."
jq -c '.[]' vo.json | while read -r row; do
  id=$(jq -r .id <<<"$row"); text=$(jq -r .text <<<"$row")
  jq -n --arg t "$text" --arg i "$NARRATOR_INSTR" \
    '{model:"gpt-4o-mini-tts", voice:"coral", input:$t, instructions:$i, response_format:"wav"}' |
  curl -sS https://api.openai.com/v1/audio/speech \
    -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d @- -o "vo/$id.wav"
  echo "$id $(ffprobe -v error -show_entries format=duration -of csv=p=0 vo/$id.wav)s"
done

# Mrs. Lan's voice note (Shot 1-2): the fixture transcript, first two sentences, in Vietnamese.
jq -n --arg t "Alô, tôi là Lan ở đường Hawthorne. Nhà tôi mất điện hai ngày rồi, từ hôm bão băng." \
  --arg i "An older Vietnamese woman, tired and cold but polite, speaking natural Northern-accented Vietnamese, slowly, as if leaving a voice message on a phone." \
  '{model:"gpt-4o-mini-tts", voice:"sage", input:$t, instructions:$i, response_format:"wav"}' |
curl -sS https://api.openai.com/v1/audio/speech -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" -d @- -o vo/lan_voice.wav
```

- **Voices.** `coral` matches the product's read-back voice (`OPENAI_TTS_VOICE=coral`). Audition `sage` and `ballad` for Mrs. Lan (check the voice list in the OpenAI text-to-speech docs before generating). Keep one narrator voice for the whole video.
- **Fit to the windows.** If a line is longer than its window in the script, regenerate it with "a little brisker" added to the instructions. Only as a last resort, apply `atempo` ≤ 1.08. Never speed up the Vietnamese voice.
- **Phone-speaker feel** for `lan_voice.wav`: `-af "highpass=f=250,lowpass=f=3800,acompressor=threshold=-18dB:ratio=3"`.
- **No key yet?** Build a muted-but-captioned preview first (the story must work muted anyway). The local fallback is Piper TTS (`en_US-lessac-medium`; Vietnamese `vi_VN-vais1000-medium`; confirm it is in the Piper voice list before relying on it). Do not publish with `espeak`.
- **Native-speaker check.** Even with no human in the loop for recording, send `vo/lan_voice.wav` and the on-screen Vietnamese and Spanish translations for review before publishing. The reviewer is still to be found (BACKLOG, blocked on a human).

---

## Step 6. Captions (SRT) and fonts for burning them in

`srt.py` builds `captions.srt`:
1. For each VO line, start at its window start (VIDEO_SCRIPT.md) and run for the duration measured with ffprobe.
2. Split the text into cues of at most 2 lines × 42 characters. Break at punctuation first.
3. Divide the line's duration among its cues by character count, with a minimum of 1.2 s per cue.
4. Add the non-VO captions too: Mrs. Lan's words (0:00–0:04), and the translation lines in Shots 5 and 7. Those are placed higher on screen as overlays, not SRT (see step 7).

**Fonts for libass.** Brand-correct and with full Vietnamese coverage:

```bash
mkdir -p fonts
# Preferred: the full static TTF from Google Fonts (OFL); if github.com is not reachable from the recorder, use the Fontsource files already in `node_modules`
curl -sSL -o fonts/BeVietnamPro-SemiBold.ttf \
  https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-SemiBold.ttf
# Offline fallback: decompress Fontsource's .woff subsets (latin, latin-ext, vietnamese) to TTF.
# libass falls back across faces with the same family name via fontconfig.
for f in $(ls apps/web/node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-{latin,latin-ext,vietnamese}-600-normal.woff); do
  python3 -c "import sys;from fontTools.ttLib import TTFont;t=TTFont(sys.argv[1]);t.flavor=None;t.save(sys.argv[2])" "$f" "fonts/$(basename "$f" .woff).ttf"
done
```

**Burn-in style** (the SRT is rendered with PlayResY 288, so FontSize 11 ≈ 41 px at 1080p). ASS colours are `&HAABBGGRR`:

```
subtitles=captions.srt:fontsdir=fonts:force_style='FontName=Be Vietnam Pro,FontSize=11,Bold=0,
PrimaryColour=&H002E2018,BackColour=&H18F8FAF9,BorderStyle=4,Outline=0,Shadow=0,MarginV=22,Alignment=2'
```

That gives ink text on a translucent `--paper-raised` box. If `BorderStyle=4` is not supported by this libass, use 3.
Upload the same `captions.srt` to YouTube as closed captions.

---

## Step 7. Build the segments (ffmpeg)

All segments are 1920×1080, 30 fps, `yuv420p`, `libx264 -crf 16 -preset slow`, with no audio. Compositions on
`color=0xEFF1EE`, with crop boxes in 2× source pixels:

| Name | Crop (w:h:x:y) | Placement at 1080p |
|---|---|---|
| **A** (one phone + big stopwatch) | phone `816:1736:48:184` → scale to h 1000 · stopwatch `1150:380:2640:184` → scale to w 1000 | phone at (300, 40); stopwatch at (840, 200) |
| **B** (three phones + small stopwatch) | phones `2532:1736:48:184` → h 1000 · stopwatch → w 400 | phones at (40, 40); stopwatch at (1500, 60) |
| **C** (sender + Dana, impersonator) | `1692:1736:48:184` → h 1000 | at (200, 40); `ov-handles.png` at (1180, 380) |
| **Full stage** | none: scale 3840→1920 | full frame |

Example: Shot 1–2 (composition A, Lan take, video 0:00–0:12). `P` = `playAt` from `lan.sync.json`; the segment
starts 2 s before the Play click:

```bash
P=$(jq .playAt takes/lan.sync.json)
ffmpeg -y -ss $(echo "$P-2" | bc) -t 12 -i takes/lan.webm -f lavfi -i "color=c=0xEFF1EE:s=1920x1080:r=30" -filter_complex "
 [0:v]fps=30,split=2[a][b];
 [a]crop=816:1736:48:184,scale=-2:1000:flags=lanczos[phone];
 [b]crop=1150:380:2640:184,scale=1000:-2:flags=lanczos[clock];
 [1:v][phone]overlay=300:40:shortest=1[t];[t][clock]overlay=840:200,format=yuv420p[v]" \
 -map "[v]" -an -c:v libx264 -crf 16 -preset slow segs/s01.mp4
```

The other segments follow the same pattern:

| Seg | Source window | Composition / effect |
|---|---|---|
| s01 | Lan, `P-2` → `P+10` | A |
| s02 | Lan, `P+10` → `P+29` | B (the hard cut at video 0:12) |
| s03 | Lan, `P+29` → `P+44` | A + `zoompan=z='min(1.04,1+0.0009*on)':d=1:s=1920x1080` on the composed frame |
| s04 | `cards/title.png`, 14 s | still. 180 ms fade in, 320 ms fade out |
| s05 | Rosa, `P-0` → `P+27` | A, with a 2 s window in B around Rosa's `P+8`…`P+12` (build as 3 sub-clips and concat) |
| s06 | Blocked, `P-0.5` → `P+8.5` | C, with a 1.5× crop zoom on Dana's handle line from `P+2.5` |
| s07 | `stills/trust-full.png` pan, 10 s | pan as in step 3 |
| s08 | `stills/stage-end.png`, 6 s | Full stage, `zoompan` push toward the rail column (x≈2650) |
| s09–s12 | `cards/code-1..4.png`, 5 s each | still, with a 2 % push-in |
| s13 | `stills/report-full.png` pan, 18 s | hold 6 s on the headline, then pan |
| s14 | Lan, last frame held, 15 s | A, with `cards/end.png` cross-fading over the stopwatch (`xfade=fade:duration=0.32`) |

Concatenate:

```bash
printf "file '%s'\n" segs/s*.mp4 > segs/list.txt
ffmpeg -y -f concat -safe 0 -i segs/list.txt -c copy video_raw.mp4
```

**Overlays and captions in one pass.** Each lower third is enabled for its window; the corner tag runs 0–150 s:

```bash
ffmpeg -y -i video_raw.mp4 -i cards/corner.png -i cards/lt-01.png -i cards/lt-02.png … -filter_complex "
 [0:v][1:v]overlay=0:0:enable='between(t,0,150)'[v1];
 [v1][2:v]overlay=0:0:enable='between(t,2,7)'[v2];
 [v2][3:v]overlay=0:0:enable='between(t,13,18)'[v3];
 …
 [vN]subtitles=captions.srt:fontsdir=fonts:force_style='…'[v]" -map "[v]" -an -c:v libx264 -crf 17 -preset slow -pix_fmt yuv420p video_captioned.mp4
```

(`build.py` generates this filter graph from `segments.json` and `overlays.json`, so timings live in data, not in
hand-edited shell.)

---

## Step 8. Audio mix, loudness and export

```bash
# VO placed by start time (ms) per VIDEO_SCRIPT.md; Mrs. Lan's voice at 0.2 s
ffmpeg -y -i video_captioned.mp4 \
  -i vo/lan_voice.wav -i vo/V1.wav -i vo/V2.wav -i vo/V3.wav -i vo/V4.wav -i vo/V5a.wav … -i vo/V9.wav \
  -i music/bed.mp3 -filter_complex "
  [1:a]adelay=200|200,volume=0.8[lan];
  [2:a]adelay=3500|3500[v1]; [3:a]adelay=12500|12500[v2]; [4:a]adelay=32000|32000[v3]; …
  [lan][v1][v2][v3]…amix=inputs=N:normalize=0[vo];
  [vo]asplit=2[vo1][vokey];
  [12:a]volume=-22dB,afade=t=out:st=24:d=1,afade=t=in:st=33:d=2,afade=t=out:st=160:d=4[bed];
  [bed][vokey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked];
  [vo1][ducked]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1:LRA=11[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart neighborline-demo.mp4
```

- V5 and V7 are split into the sub-lines marked with `/` in the script (V5a–d, V7a–c), each with its own delay.
- `afade` drops the music bed from 0:24 to 0:33, so the money moment plays in silence.
- If there is no music, drop the bed and sidechain stages. Room tone (a −60 dB pink noise bed) avoids dead-digital silence.
- Two-pass `loudnorm` is better: run pass 1 with `print_format=json`, then feed the `measured_*` values into pass 2.

---

## Step 9. Automated QA (the agent checks its own work)

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 neighborline-demo.mp4      # must be < 170
ffmpeg -i neighborline-demo.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12          # I ≈ -14 LUFS, TP ≤ -1
ffmpeg -y -i neighborline-demo.mp4 -vf "fps=1/4,scale=480:-1,tile=6x7" qa/contact.png    # whole video at a glance
for t in 0.5 3 10 13 30 40 50 1:15 1:30 1:40 1:50 2:00 2:20 2:40; do
  ffmpeg -y -loglevel error -ss $t -i neighborline-demo.mp4 -frames:v 1 "qa/f_${t/:/m}.png"; done
```

Read `qa/contact.png` and each `qa/f_*.png` (the Read tool shows images), and check:
- [ ] 0:00.5: Lan's phone and the stopwatch are both visible, and the corner tag is present.
- [ ] 0:10: the read-back is in Vietnamese, the stopwatch is running, and the captions are legible.
- [ ] 0:30–0:40: the phone is warm, the stopwatch is amber and frozen at `{T}`, and the lower third says "on cue".
- [ ] Nothing before 1:36 shows the rail column, `/ledger` or `/organizer` full-screen.
- [ ] 1:15: "UNCLAIMED" is visible, and so is "Shown at 2× speed".
- [ ] 1:30: "Lookalike handle blocked" and "Approve disabled" are visible.
- [ ] 1:50: the ids in the rail are readable.
- [ ] 2:20: "Seeded demo data" is visible.
- [ ] 2:40: the hosted URL and repo URL are correct and readable at 480 px wide.
- [ ] No frame shows a PayPal or Venmo logo, a browser UI, an OS notification or a cursor where one is not intended.
- [ ] Run Whisper (`gpt-4o-transcribe`) on the final audio and diff it against VIDEO_SCRIPT.md §2 to catch TTS slips.

---

## Step 10. Hand-off (a human does this)

The agent produces a folder with:
- `neighborline-demo.mp4`
- `thumbnail-1280x720.png` (16:9, YouTube) and `thumbnail-1500x1000.png` (3:2, Devpost), both from THUMBNAIL_BRIEF.md
- `captions.srt`
- `youtube-description.txt`: tagline, links, chapters, sources, music credit, and the synthetic-voice note

A human uploads it to YouTube, because that needs an OAuth login. If a YouTube Data API OAuth refresh token is
provided later, the agent can upload with `videos.insert` and `captions.insert`. The human must still tick the
synthetic-content disclosure and check the visibility setting. Then the human pastes the YouTube URL into Devpost.

## Re-recording cost

Once `record.mjs`, `cards.mjs`, `srt.py` and `build.py` exist, a full rebuild is one command and about 6 minutes
(about 2.5 minutes of takes plus encoding). Re-record whenever the UI copy changes, so the video never drifts from
the hosted app the judges will open.
