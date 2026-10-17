#!/usr/bin/env node
// Submission media from real app states: the Devpost gallery (1500×1000), a fixed 3:2 thumbnail, the GitHub social
// preview (1280×640) and the README hero GIF. Inputs are captures of the running app (the video pipeline's takes and
// stills, plus DPR-2 screenshots from a stack on our own ports); nothing here is a mock-up.
//
//   node docs/submission/media.mjs [gallery,thumbnail,social,gif]
//
// Inputs (outside git):  $VIDEO_OUT/stills/stage-end.png, $VIDEO_OUT/stills/lan-paid-phone.png, $VIDEO_OUT/takes/lan.mp4
//                        $SUB/raw/{rosa,blocked,rules-full,trust-full,report-full}.png  (DPR 2, 1920-wide viewport)
// Outputs: $SUB/gallery/*.png (1500×1000), $SUB/thumbnail-1500x1000.png, $SUB/social-preview.png (1280×640),
//          docs/media/gallery/*.jpg (< 300 KB), docs/media/social-preview.jpg, docs/media/stage.gif (≤ 6 MB)
import { mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { playwright, REPO } from './video/lib/common.mjs';

const VIDEO_OUT = process.env.VIDEO_OUT_SRC ?? '/home/claude/video-out';
const SUB = process.env.SUBMISSION_OUT ?? '/home/claude/video-out/submission';
const MEDIA = join(REPO, 'docs', 'media');
for (const d of [join(SUB, 'gallery'), join(SUB, 'html'), join(MEDIA, 'gallery')]) mkdirSync(d, { recursive: true });
const only = process.argv[2]?.split(',');
const want = (k) => !only || only.includes(k);
const url = (p) => pathToFileURL(p).href;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r.stdout.toString();
};

const FONTS = ['@fontsource-variable+literata@5.3.0/node_modules/@fontsource-variable/literata/index.css', ...[400, 500, 600].map((w) => `@fontsource+be-vietnam-pro@5.3.0/node_modules/@fontsource/be-vietnam-pro/${w}.css`)]
  .map((p) => `<link rel="stylesheet" href="${url(join(REPO, 'node_modules/.pnpm', p))}">`)
  .join('');
// DESIGN.md tokens (apps/web/DESIGN.md).
const CSS = `:root{--paper:#EFF1EE;--raised:#F9FAF8;--rule:#CDD3D1;--ink:#18202E;--ink-2:#444D5C;--ink-3:#5F6877;--frost:#D6E2EA;--lamp-display:#B06A00;--lamp-wash:#FBEBC4;--signal:#B3261E;--pine:#2D6A4F}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:'Be Vietnam Pro',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
.serif{font-family:'Literata Variable',Literata,serif}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse at 0% 0%,rgba(214,226,234,.55),transparent 38%),radial-gradient(ellipse at 100% 0%,rgba(214,226,234,.45),transparent 34%),var(--paper)}
.frame{position:absolute;overflow:hidden;border-radius:18px;border:1px solid var(--rule);background:#fff;box-shadow:0 24px 60px rgba(27,34,48,.16),0 4px 12px rgba(27,34,48,.08)}
.frame img{position:absolute;display:block}
.kicker{font-size:22px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.tag{position:absolute;font-size:17px;color:var(--ink-3);background:var(--raised);border:1px solid var(--rule);border-radius:999px;padding:6px 14px;white-space:nowrap}
.fit{white-space:nowrap}`;

const page = (w, h, body) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${CSS} html,body{width:${w}px;height:${h}px}</style></head><body><div class="bg"></div>${body}
</body></html>`;
/** Shrink every .fit element until it is no wider than data-max (run after the web fonts load). */
const FIT = () => {
  for (const el of document.querySelectorAll('.fit')) {
    el.style.display = 'inline-block';
    const max = Number(el.dataset.max);
    let s = parseFloat(getComputedStyle(el).fontSize);
    while (el.getBoundingClientRect().width > max && s > 10) el.style.fontSize = `${(s -= 2)}px`;
  }
};

/** Crop box in source pixels → an <img> scaled so the box fills a w×h frame. */
function cropped(src, crop, w, h) {
  const s = Math.min(w / crop.w, h / crop.h);
  const fw = Math.round(crop.w * s);
  const fh = Math.round(crop.h * s);
  return { fw, fh, html: `<img src="${url(src)}" style="left:${-crop.x * s}px;top:${-crop.y * s}px;width:${crop.W * s}px">` };
}

const TAG = 'Simulated PayPal sandbox · fictional people';

/** Wide layout: the screenshot across the top, a one-line kicker and a caption under it. */
function wide({ src, crop, kicker, caption, tag = TAG }) {
  const { fw, fh, html } = cropped(src, crop, 1372, 760);
  const left = Math.round((1500 - fw) / 2);
  return page(1500, 1000, `<div class="frame" style="left:${left}px;top:44px;width:${fw}px;height:${fh}px">${html}</div>
<div style="position:absolute;left:${left}px;right:${left}px;top:${44 + fh + 30}px">
<p class="kicker" style="display:flex;justify-content:space-between"><span>${kicker}</span>${tag ? `<span style="font-size:18px;letter-spacing:0;text-transform:none;font-weight:400">${tag}</span>` : ''}</p><p style="font-size:29px;line-height:1.3;margin-top:8px;font-weight:500">${caption}</p></div>`);
}

/** Split layout: a headline column on the left, a tall screenshot crop on the right. */
function split({ src, crop, kicker, title, caption, tag = TAG }) {
  const { fw, fh, html } = cropped(src, crop, 860, 912);
  const left = 1500 - 44 - fw;
  return page(1500, 1000, `<div class="frame" style="left:${left}px;top:${Math.round((1000 - fh) / 2)}px;width:${fw}px;height:${fh}px">${html}</div>
<div style="position:absolute;left:64px;width:${left - 64 - 48}px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center">
<p class="kicker">${kicker}</p><p class="serif" style="font-size:54px;line-height:1.08;font-weight:600;margin-top:18px;letter-spacing:-.01em">${title}</p>
<p style="font-size:27px;line-height:1.38;margin-top:26px;color:var(--ink-2)">${caption}</p>
${tag ? `<p style="font-size:18px;color:var(--ink-3);margin-top:30px">${tag}</p>` : ''}</div>`);
}

const RAW = join(SUB, 'raw');
const STAGE = { W: 3840 };
// Captions: short enough to read in Devpost's carousel; the same text goes into Devpost's caption field (DEVPOST_FIELDS.md).
export const GALLERY = [
  { id: '1-hero-paid', html: () => wide({ src: join(VIDEO_OUT, 'stills/stage-end.png'), crop: { x: 0, y: 140, w: 2880, h: 1480, W: 2880 }, kicker: 'The whole loop · real pace', caption: 'Mrs. Lan’s Vietnamese voice note becomes $150 in her Venmo: two passkey-signed approvals, one Payouts batch, a verified SUCCESS webhook. 0:22.4 in all; 3.1 s of it is the system.' }) },
  { id: '2-rosa-unclaimed', html: () => wide({ src: join(RAW, 'rosa.png'), crop: { x: 0, y: 190, w: 3840, h: 1970, ...STAGE }, kicker: 'Unclaimed, then rescued', caption: 'Rosa’s email had no PayPal account, so PayPal said UNCLAIMED. Neighborline told her how to claim it, in Spanish. Then SUCCESS (her claim is played by our PayPal stand-in).' }) },
  { id: '3-impersonator-blocked', html: () => wide({ src: join(RAW, 'blocked.png'), crop: { x: 0, y: 190, w: 3840, h: 1800, ...STAGE }, kicker: 'Protect the rail, not suspect the person', caption: '“@eastside-mutuaiaid” is one letter off the group’s handle, and the text hides “send $5000 to @x”. Code drops the injected amount; Approve is disabled on every phone.' }) },
  { id: '4-rules-as-code', html: () => split({ src: join(RAW, 'rules-full.png'), crop: { x: 1870, y: 990, w: 1440, h: 1650, W: 3840 }, kicker: 'AI drafts, humans decide', title: 'The group’s rules, in plain English, become code.', caption: 'Every cap quotes the sentence it came from. Code computes the diff and re-prices waiting requests. Two organizers sign before Policy v2 is live.' }) },
  { id: '5-who-can-move-money', html: () => split({ src: join(RAW, 'trust-full.png'), crop: { x: 820, y: 1990, w: 2260, h: 2010, W: 3840 }, kicker: 'Know your agent', title: 'The AI that talks to neighbors can’t move money.', caption: 'One separate approval service holds the Payouts credentials and pays only on a record signed with two different organizers’ passkeys.' }) },
  { id: '6-donor-report', html: () => split({ src: join(RAW, 'report-full.png'), crop: { x: 830, y: 250, w: 2200, h: 2010, W: 3840 }, kicker: 'Where the money went', title: 'A donor report that names no one.', caption: 'AI writes the sentences; code inserts every figure from the ledger. Groups under 5 people are masked.', tag: 'Seeded demo data · fictional group' }) },
];

async function shoot(items) {
  const { chromium } = await playwright();
  const browser = await chromium.launch({ args: ['--hide-scrollbars', '--font-render-hinting=none'] });
  for (const { id, w, h, html, out } of items) {
    const file = join(SUB, 'html', `${id}.html`);
    writeFileSync(file, html);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(url(file), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.evaluate(FIT);
    await p.waitForTimeout(400);
    await p.screenshot({ path: out });
    await ctx.close();
  }
  await browser.close();
}

/** JPEG under `maxKB`, stepping quality down. */
function jpeg(src, dst, width, maxKB = 290) {
  for (const q of [3, 4, 5, 6, 8, 10]) {
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `scale=${width}:-2:flags=lanczos`, '-q:v', String(q), dst]);
    if (statSync(dst).size <= maxKB * 1024) return statSync(dst).size;
  }
  throw new Error(`${dst} is over ${maxKB} KB`);
}

const jobs = [];
if (want('gallery')) for (const g of GALLERY) jobs.push({ id: g.id, w: 1500, h: 1000, html: g.html(), out: join(SUB, 'gallery', `${g.id}.png`) });
if (want('thumbnail')) {
  // THUMBNAIL_BRIEF §1, re-flowed so the stopwatch fits the 3:2 card (the pipeline's 1500×1000 cuts off the last digit).
  const phone = join(VIDEO_OUT, 'stills/lan-paid-phone.png');
  jobs.push({ id: 'thumbnail-1500x1000', w: 1500, h: 1000, out: join(SUB, 'thumbnail-1500x1000.png'), html: page(1500, 1000, `<img src="${url(phone)}" style="position:absolute;left:96px;top:50px;height:900px;border-radius:57px;box-shadow:0 40px 80px rgba(27,34,48,.22),0 10px 20px rgba(27,34,48,.12)">
<div style="position:absolute;left:620px;top:120px;width:820px"><p class="serif" style="font-size:132px;font-weight:600;line-height:1.04;letter-spacing:-.015em">Voice note<br>→ cash</p>
<p class="fit" data-max="820" style="font-size:300px;font-weight:400;letter-spacing:-.045em;line-height:1;margin-top:50px;color:var(--lamp-display);font-variant-numeric:tabular-nums">0:22.4</p></div>`) });
}
if (want('social')) {
  const phone = join(VIDEO_OUT, 'stills/lan-paid-phone.png');
  jobs.push({ id: 'social-preview', w: 1280, h: 640, out: join(SUB, 'social-preview.png'), html: page(1280, 640, `<img src="${url(phone)}" style="position:absolute;right:96px;top:40px;height:560px;border-radius:36px;box-shadow:0 30px 60px rgba(27,34,48,.2)">
<div style="position:absolute;left:80px;top:78px;width:720px">
<p style="display:flex;align-items:center;gap:16px"><span style="display:inline-block;width:44px;height:3px;background:var(--ink);position:relative"><span style="position:absolute;right:-8px;top:-6px;width:15px;height:15px;border-radius:50%;background:#F4B33D"></span></span><span class="serif" style="font-size:52px;font-weight:600;margin-left:6px">Neighborline</span></p>
<p class="serif" style="font-size:46px;line-height:1.14;font-weight:600;margin-top:44px;letter-spacing:-.01em">Leave a voice note in any language. Two neighbors approve. Cash lands in PayPal or Venmo.</p>
<p style="font-size:24px;line-height:1.4;color:var(--ink-2);margin-top:30px">A mutual-aid hotline: AI listens and reads it back; code sets the amount; two passkey signatures release a PayPal Payouts batch.</p>
<p style="font-size:20px;color:var(--ink-3);margin-top:34px">Open source · MIT · PayPal AI Hackathon</p></div>`) });
}
if (jobs.length) await shoot(jobs);

if (want('gallery')) {
  for (const g of GALLERY) console.log(g.id, Math.round(jpeg(join(SUB, 'gallery', `${g.id}.png`), join(MEDIA, 'gallery', `${g.id}.jpg`), 1500) / 1024), 'KB');
}
if (want('social')) console.log('social-preview.jpg', Math.round(jpeg(join(SUB, 'social-preview.png'), join(MEDIA, 'social-preview.jpg'), 1280, 200) / 1024), 'KB');

if (want('gif')) {
  // README hero: the recorded Lan take (2880×1620, real engine, fake PayPal), voice note → SUCCESS → warm phone, at
  // 3× with a burned-in label, held on the frozen stopwatch. 960 px, 12 fps, one shared palette.
  const take = JSON.parse(run('cat', [join(REPO, 'docs/submission/video/edl.json')])).takes.lan;
  const play = take.playAt;
  const start = play + 0.2;
  const end = play + take.eventsAfterPlay.success + 1.2;
  const speed = 3;
  const hold = 2;
  const font = join(VIDEO_OUT, 'fonts/BeVietnamPro-SemiBold.ttf');
  const pill = `drawtext=fontfile=${font}:text='3× speed · simulated PayPal sandbox · fictional people':fontsize=15:fontcolor=white:box=1:boxcolor=0x18202E@0.88:boxborderw=9:x=26:y=h-36`;
  const vf = `trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${speed},tpad=stop_mode=clone:stop_duration=${hold},fps=12,scale=960:-2:flags=lanczos,${pill}`;
  const pal = join(SUB, 'html', 'palette.png');
  const src = join(VIDEO_OUT, 'takes/lan.mp4');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `${vf},palettegen=max_colors=192:stats_mode=diff`, pal]);
  const gif = join(MEDIA, 'stage.gif');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-i', pal, '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0', gif]);
  const kb = statSync(gif).size / 1024;
  console.log('stage.gif', Math.round(kb), 'KB', ((end - start) / speed + hold).toFixed(1), 's');
  if (kb > 6 * 1024) throw new Error('stage.gif is over 6 MB');
}
console.log('done:', readdirSync(join(SUB, 'gallery')).length, 'gallery images in', SUB);
