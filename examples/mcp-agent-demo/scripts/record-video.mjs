#!/usr/bin/env node
// Records the scripted MCP demo as a 1920×1080 terminal video for the submission cut.
//
//   pnpm --filter @neighborline/example-mcp-agent-demo record
//   VIDEO_OUT=/somewhere node scripts/record-video.mjs [--still-only]
//
// 1. Runs the real scripted demo (stdio MCP server + fake PayPal) and saves its transcript as JSON.
// 2. Renders the transcript into an HTML terminal styled with the app's own fonts (Fontsource, via apps/web) and
//    DESIGN.md colors. The page draws any moment of the timeline with `setT(seconds)`, so capture is deterministic.
// 3. Steps through the timeline at 30 fps with Playwright screenshots, piped into ffmpeg (H.264, yuv420p).
// Outputs: $VIDEO_OUT/takes/mcp-demo.mp4 (+ .markers.json with beat times), and a small PNG still in
// docs/submission/video/mcp-demo.png (committed; the mp4 is not).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = join(HERE, '..', '..');
const OUT = process.env.VIDEO_OUT ?? '/home/claude/video-out';
const TAKES = join(OUT, 'takes');
const WORK = join(OUT, 'mcp-demo');
const STILL = join(REPO, 'docs', 'submission', 'video', 'mcp-demo.png');
const FPS = 30;
mkdirSync(TAKES, { recursive: true });
mkdirSync(WORK, { recursive: true });

const webRequire = createRequire(join(REPO, 'apps', 'web', 'package.json'));
const fontHref = (p) => pathToFileURL(webRequire.resolve(p)).href;
const { chromium } = await import(pathToFileURL(webRequire.resolve('@playwright/test')).href).then((m) => (m.chromium ? m : m.default));

// ---------- 1. a real run ----------
const transcriptPath = join(WORK, 'transcript.json');
execFileSync(process.execPath, ['--import', 'tsx', join(HERE, 'src', 'main.ts'), '--scripted', '--no-color', '--json', transcriptPath], { cwd: HERE, stdio: ['ignore', 'ignore', 'inherit'] });
const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
const ev = transcript.events;

// ---------- 2. the timeline: what appears when ----------
// Typed lines (the user and the agent) type at `cps`; MCP answers and humans appear whole after a beat.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = []; // { at, typeMs, html, text, cls, marker? }
let t = 0.35;
const add = (cls, label, text, { type = 0, gapBefore = 0, hold = 0.25, marker, rich } = {}) => {
  t += gapBefore;
  const typeMs = type ? (text.length / type) * 1000 : 0;
  lines.push({ at: t, typeMs, cls, label, text, rich, marker });
  t += typeMs / 1000 + hold;
};
const banner = ev.find((e) => e.kind === 'banner');
add('banner', '', banner.text, { hold: 0.1, marker: 'start' });
add('dim', '', banner.detail, { hold: 0.35 });
for (const e of ev) {
  switch (e.kind) {
    case 'step':
      add('step', '', `${e.n}  ${e.title}`, { gapBefore: 0.15, hold: 0.2 });
      break;
    case 'user':
      add('user', 'user', e.text, { type: 95, hold: 0.25 });
      break;
    case 'agent':
      add('agent', 'agent', e.text, { type: 110, hold: 0.45 });
      break;
    case 'call':
      add('call', 'agent', e.summary, { type: 120, hold: 0.45, rich: `<b>→ ${esc(e.tool)}</b> ${esc(e.summary)}` });
      break;
    case 'result':
      add(e.ok ? 'ok' : 'err', 'mcp', e.summary, {
        hold: e.ok ? 0.55 : 1.3,
        marker: e.tool === 'create_payout_batch' ? (e.ok ? 'paid' : 'refused') : e.tool === 'get_payout_batch' ? 'success' : e.tool === 'reconcile_payouts' ? 'reconciled' : undefined,
        rich: `<span class="mark">${e.ok ? '✓' : '✗'}</span> ${esc(e.summary)}`,
      });
      break;
    case 'human':
      add('human', 'human', e.text, { hold: 0.5, marker: /2 of 2/.test(e.text) ? 'approval2' : 'approval1', rich: `<b>${esc(e.who)}</b> ${esc(e.text)}` });
      break;
    case 'token':
      add('token', 'token', e.summary, { hold: 0.9, marker: 'token' });
      break;
    case 'done':
      add('done', '', e.text, { gapBefore: 0.2, hold: 0, marker: 'done' });
      break;
  }
}
const DURATION = Math.round((t + 2.2) * FPS) / FPS; // hold the last frame
const markers = Object.fromEntries(lines.filter((l) => l.marker).map((l) => [l.marker, +(l.at + l.typeMs / 1000).toFixed(2)]));

// ---------- 3. the page ----------
const css = `
:root{--paper:#EFF1EE;--raised:#F9FAF8;--ink:#18202E;--ink-2:#444D5C;--rule:#CDD3D1;--frost:#D6E2EA;--frost-ink:#27445E;--lamp:#F4B33D;--lamp-ink:#7A4700;--pine:#2D6A4F;--signal:#B3261E;
  --term:#141B27;--term-2:#1C2533;--t-ink:#E6EAE8;--t-dim:#8D97A6;--t-ok:#7CC49A;--t-err:#F08A80;--t-lamp:#F4B33D;--t-frost:#9CC3E0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:var(--paper)}
body{font-family:'Be Vietnam Pro',sans-serif;-webkit-font-smoothing:antialiased;color:var(--ink)}
.top{position:absolute;left:72px;right:72px;top:34px;height:44px;display:flex;align-items:center;justify-content:space-between}
.top .title{font-size:26px;font-weight:600;letter-spacing:-0.005em}
.top .title .mono{font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-weight:600}
.top .tag{font-size:19px;color:var(--ink-2);background:var(--raised);border:1px solid var(--rule);border-radius:999px;padding:6px 16px}
.win{position:absolute;left:72px;right:72px;top:96px;bottom:44px;background:var(--term);border-radius:18px;box-shadow:0 18px 50px rgba(24,32,46,.22);overflow:hidden}
.bar{height:46px;background:var(--term-2);display:flex;align-items:center;padding:0 20px;gap:10px}
.dot{width:13px;height:13px;border-radius:50%;background:#3A4556}
.bar .cmd{margin-left:16px;font:500 18px 'Atkinson Hyperlegible Mono Variable',monospace;color:var(--t-dim)}
.screen{position:absolute;top:46px;left:0;right:0;bottom:0;padding:22px 36px;overflow:hidden}
.flow{position:relative}
.ln{display:flex;font:400 23px/1.5 'Atkinson Hyperlegible Mono Variable',monospace;color:var(--t-ink);white-space:pre-wrap;word-break:break-word}
.ln .lab{flex:0 0 96px;color:var(--t-dim)}
.ln .txt{flex:1;min-width:0}
.ln b{font-weight:700}
.banner .txt{font-weight:700;color:#fff}
.dim .txt{color:var(--t-dim);font-size:19px}
.step{margin-top:12px;color:var(--t-lamp)}
.step .txt{border-top:1px solid #2E3A4C;padding-top:8px;font-weight:700;letter-spacing:.01em}
.user .txt{color:#fff}
.agent .lab,.call .lab{color:var(--t-frost)}
.call b{color:var(--t-frost)}
.ok .mark{color:var(--t-ok);font-weight:700}
.err .txt{color:var(--t-err)}
.err .mark{font-weight:700}
.human .lab,.token .lab{color:var(--t-lamp)}
.token .txt{color:var(--t-ink)}
.done{margin-top:14px}
.done .txt{color:var(--t-ok);font-weight:700;font-size:25px}
.cur{display:inline-block;width:.6em;height:1.05em;background:var(--t-ink);vertical-align:-0.18em;margin-left:1px}
.hidden{visibility:hidden}
`;
const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fontHref('@fontsource/be-vietnam-pro/400.css')}">
<link rel="stylesheet" href="${fontHref('@fontsource/be-vietnam-pro/600.css')}">
<link rel="stylesheet" href="${fontHref('@fontsource-variable/atkinson-hyperlegible-mono/index.css')}">
<style>${css}</style></head><body>
<div class="top"><div class="title">An AI agent pays a neighbor through <span class="mono">neighborline-payouts-mcp</span></div>
<div class="tag">Real MCP over stdio · fake PayPal · scripted agent, no LLM</div></div>
<div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
<span class="cmd">$ pnpm --filter @neighborline/example-mcp-agent-demo demo</span></div>
<div class="screen"><div class="flow" id="flow"></div></div></div>
<script>
const LINES = ${JSON.stringify(lines)};
const flow = document.getElementById('flow');
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const els = LINES.map((l) => {
  const d = document.createElement('div');
  d.className = 'ln ' + l.cls + ' hidden';
  d.innerHTML = (l.label !== undefined && l.cls !== 'banner' && l.cls !== 'dim' && l.cls !== 'step' && l.cls !== 'done' ? '<span class="lab">' + esc(l.label) + '</span>' : '') + '<span class="txt"></span>';
  flow.appendChild(d);
  return d;
});
window.setT = (t) => {
  let typing = -1;
  LINES.forEach((l, i) => {
    const el = els[i], txt = el.querySelector('.txt');
    if (t < l.at) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const done = !l.typeMs || t >= l.at + l.typeMs / 1000;
    if (done) { txt.innerHTML = l.rich ?? esc(l.text); return; }
    typing = i;
    const n = Math.floor(((t - l.at) * 1000 / l.typeMs) * l.text.length);
    // While typing, the rich prefix (tool name) is shown first; the plain text follows.
    txt.innerHTML = (l.cls === 'call' ? '<b>→ ' + esc(l.rich.match(/→ ([^<]+)/)[1]) + '</b> ' : '') + esc(l.text.slice(0, n)) + '<span class="cur"></span>';
  });
  // Idle cursor after the last visible line when nothing is typing.
  document.querySelectorAll('.idle').forEach((e) => e.remove());
  if (typing < 0) {
    const vis = els.filter((e) => !e.classList.contains('hidden'));
    const last = vis.at(-1);
    if (last && Math.floor(t * 2) % 2 === 0) { const c = document.createElement('span'); c.className = 'cur idle'; last.querySelector('.txt').appendChild(c); }
  }
  // Keep the newest line in view: scroll the flow up once it would overflow the screen.
  const screen = flow.parentElement.getBoundingClientRect();
  const vis = els.filter((e) => !e.classList.contains('hidden'));
  const bottom = vis.length ? vis.at(-1).getBoundingClientRect().bottom - flow.getBoundingClientRect().top : 0;
  const room = screen.height - 44;
  flow.style.transform = 'translateY(' + (-Math.max(0, bottom - room)) + 'px)';
};
</script></body></html>`;
const htmlPath = join(WORK, 'terminal.html');
writeFileSync(htmlPath, page);

// ---------- 4. capture ----------
const browser = await chromium.launch({ args: ['--lang=en-US', '--hide-scrollbars', '--font-render-hinting=none'] });
const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
await tab.evaluate(() => document.fonts.ready);
const fonts = await tab.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
if (!fonts.some((f) => /Atkinson/.test(f)) || !fonts.some((f) => /Be Vietnam/.test(f))) throw new Error(`fonts did not load: ${fonts.join(', ')}`);

// The final frame: check nothing overflowed horizontally, then save the still (downscaled, small).
await tab.evaluate((d) => window.setT(d), DURATION);
const overflow = await tab.evaluate(() => [...document.querySelectorAll('.ln')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
if (overflow) throw new Error(`${overflow} terminal lines overflow horizontally`);
const fullStill = join(WORK, 'still-1920.png');
await tab.screenshot({ path: fullStill });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', fullStill, '-vf', 'scale=1280:-2:flags=lanczos', '-pix_fmt', 'rgb24', STILL]);
// Committed to git, so keep it small: a 128-colour palette is lossless-looking for flat UI text (Pillow, if present).
try {
  execFileSync('python3', ['-c', 'import sys;from PIL import Image;p=sys.argv[1];Image.open(p).convert("RGB").quantize(colors=128,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).save(p,optimize=True)', STILL]);
} catch {
  console.warn('[mcp-demo] Pillow not available; the still is saved unquantized');
}

if (!process.argv.includes('--still-only')) {
  const mp4 = join(TAKES, 'mcp-demo.mp4');
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  const frames = Math.round(DURATION * FPS);
  for (let i = 0; i < frames; i++) {
    await tab.evaluate((s) => window.setT(s), i / FPS);
    const buf = await tab.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  writeFileSync(join(TAKES, 'mcp-demo.markers.json'), JSON.stringify({ duration: DURATION, fps: FPS, markers, batchId: ev.find((e) => e.kind === 'result' && e.ok && e.tool === 'create_payout_batch')?.summary }, null, 2));
  console.log(`[mcp-demo] ${mp4} (${DURATION.toFixed(1)} s, ${frames} frames); markers: ${JSON.stringify(markers)}`);
}
await browser.close();
console.log(`[mcp-demo] still: ${STILL}`);
