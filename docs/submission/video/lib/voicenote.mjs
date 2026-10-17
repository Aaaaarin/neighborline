// The cold open (JUDGE-PANEL-2 #5a): Mrs. Lan's voice note as audio-first video. A voice-note bubble whose waveform
// fills as it plays, her Vietnamese words lighting up as she says them with the English underneath, and the hook line
// on screen by 0.9 s. No idle phone, no "Press Play".
//
// Rendered frame by frame (page.setT(t) → screenshot → ffmpeg), so it is deterministic. With --with-vo the waveform
// and the word timing come from the real voice file; without it, from a seeded speech-like envelope of the same length.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHROME_ARGS, DIRS, log, playwright } from './common.mjs';
import { TOKENS, fontCss } from './cards.mjs';

const BARS = 72;

/** RMS per bar from a voice file (mono 8 kHz s16), normalised to 0.12–1. */
export function envelopeFromFile(file, bars = BARS) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`envelope: ffmpeg failed on ${file}`);
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2));
  const per = Math.max(1, Math.floor(pcm.length / bars));
  const rms = Array.from({ length: bars }, (_, b) => {
    let s = 0;
    for (let i = b * per; i < (b + 1) * per && i < pcm.length; i++) s += pcm[i] * pcm[i];
    return Math.sqrt(s / per);
  });
  const max = Math.max(...rms) || 1;
  return rms.map((v) => 0.12 + 0.88 * Math.min(1, v / max));
}

/** A seeded, speech-like envelope: syllable bumps, short pauses at the commas and the full stop. */
export function syntheticEnvelope(words, bars = BARS) {
  let h = 2166136261;
  const rnd = () => ((h = Math.imul(h ^ 0x9e3779b9, 16777619) >>> 0), (h % 1000) / 1000);
  const chars = words.reduce((a, w) => a + w.length + 1, 0);
  const out = [];
  let acc = 0;
  for (const w of words) {
    const n = Math.max(1, Math.round(((w.length + 1) / chars) * bars));
    for (let i = 0; i < n && out.length < bars; i++) out.push(0.3 + 0.7 * rnd() * Math.sin((Math.PI * (i + 0.5)) / n) ** 0.6);
    acc += n;
    if (/[,.]$/.test(w) && out.length < bars) out.push(0.1);
  }
  while (out.length < bars) out.push(0.1);
  return out.slice(0, bars);
}

/**
 * Word timings over `speech` seconds starting at `t0`, proportional to each word's length, with a beat at punctuation.
 * Returns [{ w, at }] for the Vietnamese words.
 */
export function wordTimes(words, t0, speech) {
  const weight = (w) => w.length + 2 + (/[.]$/.test(w) ? 6 : /[,]$/.test(w) ? 3 : 0);
  const total = words.reduce((a, w) => a + weight(w), 0);
  let t = t0;
  return words.map((w) => {
    const at = t;
    t += (speech * weight(w)) / total;
    return { w, at: +at.toFixed(3) };
  });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Renders segs/<id>.mp4 for the cold-open shot.
 * shot: { dur, voice: { vi, en, meta, start, speech }, hook: { lines, at } }
 */
export async function voiceNoteSegment(shot, file, { voiceFile = null, voiceSeconds = null } = {}) {
  const v = shot.voice;
  const vi = v.vi.split(/\s+/).filter(Boolean);
  const speech = Math.min(voiceSeconds ?? v.speech, shot.dur - v.start - 0.25);
  const env = voiceFile ? envelopeFromFile(voiceFile) : syntheticEnvelope(vi);
  const times = wordTimes(vi, v.start, speech);
  // English sentences fade in when the matching Vietnamese sentence starts.
  const viSentenceStarts = times.filter((x, i) => i === 0 || /[.]$/.test(vi[i - 1])).map((x) => x.at);
  const en = v.en.map((s, i) => ({ s, at: viSentenceStarts[i] ?? viSentenceStarts.at(-1) }));
  const total = Math.ceil((voiceSeconds ?? v.speech) - 0.05);
  const css = `
.hook{position:absolute;left:150px;top:150px;width:1620px}
.hook p{font-family:'Literata Variable',serif;font-weight:600;font-size:60px;line-height:1.16;letter-spacing:-0.015em}
.hook p+p{color:var(--ink-2);font-weight:500;font-size:46px;margin-top:10px}
.meta{position:absolute;left:150px;top:418px;font-size:24px;color:var(--ink-3)}
.bubble{position:absolute;left:150px;top:460px;width:1240px;height:132px;border-radius:30px 30px 30px 8px;background:var(--frost);display:flex;align-items:center;gap:28px;padding:0 40px 0 34px;box-shadow:0 10px 30px rgba(27,34,48,.10)}
.btn{width:72px;height:72px;border-radius:50%;background:var(--frost-ink);flex:none;display:grid;place-items:center}
.bars{flex:1;display:flex;align-items:center;gap:5px;height:84px}
.bars i{display:block;flex:1;border-radius:4px;background:rgba(39,68,94,.28)}
.bars i.on{background:var(--frost-ink)}
.time{font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:28px;color:var(--frost-ink);flex:none;font-variant-numeric:tabular-nums}
.vi{position:absolute;left:150px;top:648px;width:1620px;font-size:46px;font-weight:600;line-height:1.32}
.vi span{opacity:.22;transition:none}.vi span.on{opacity:1}
.en{position:absolute;left:150px;top:796px;width:1620px;font-size:31px;line-height:1.4;color:var(--ink-2)}
.en span{opacity:0}.en span.on{opacity:1}
.lbl{display:inline-block;font-size:19px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin-right:14px}`;
  const body = `
<div class="hook" id="hook">${shot.hook.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
<div class="meta" id="meta">${esc(v.meta)}</div>
<div class="bubble" id="bubble">
  <div class="btn"><svg width="30" height="30" viewBox="0 0 30 30" id="icon"></svg></div>
  <div class="bars">${env.map((h) => `<i style="height:${Math.round(h * 100)}%"></i>`).join('')}</div>
  <div class="time" id="time">0:00</div>
</div>
<div class="vi" lang="vi" id="vi"><span class="lbl" style="opacity:1">Tiếng Việt</span>${times.map((x) => `<span>${esc(x.w)}</span>`).join(' ')}</div>
<div class="en" id="en"><span class="lbl" style="opacity:1">English</span>${en.map((x) => `<span>${esc(x.s)}</span>`).join(' ')}</div>
<script>
const W = ${JSON.stringify(times.map((x) => x.at))}, E = ${JSON.stringify(en.map((x) => x.at))};
const V0 = ${v.start}, SP = ${speech}, TOTAL = ${total}, HOOK = ${shot.hook.at};
const bars = [...document.querySelectorAll('.bars i')], vw = [...document.querySelectorAll('#vi span:not(.lbl)')], ew = [...document.querySelectorAll('#en span:not(.lbl)')];
const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
window.setT = (t) => {
  const p = Math.min(1, Math.max(0, (t - V0) / SP));
  bars.forEach((b, i) => b.classList.toggle('on', i < Math.round(p * bars.length)));
  vw.forEach((s, i) => s.classList.toggle('on', t >= W[i]));
  ew.forEach((s, i) => { s.style.opacity = String(ease((t - E[i]) / 0.35)); });
  const playing = t >= V0 && t < V0 + SP;
  document.getElementById('icon').innerHTML = playing
    ? '<rect x="7" y="5" width="5.5" height="20" rx="1.5" fill="#F9FAF8"/><rect x="17.5" y="5" width="5.5" height="20" rx="1.5" fill="#F9FAF8"/>'
    : '<path d="M9 5.5v19l16-9.5z" fill="#F9FAF8"/>';
  const s = Math.min(TOTAL, Math.round(p * TOTAL));
  document.getElementById('time').textContent = '0:' + String(s).padStart(2, '0') + ' / 0:' + String(TOTAL).padStart(2, '0');
  const h = document.getElementById('hook');
  const k = ease((t - HOOK) / 0.4);
  h.style.opacity = String(k);
  h.style.transform = 'translateY(' + ((1 - k) * 14).toFixed(1) + 'px)';
  const bk = 1; // the bubble is there from the first frame (the video's first frame is never empty)
  document.getElementById('bubble').style.opacity = String(bk);
  document.getElementById('meta').style.opacity = String(bk);
};
</script>`;
  const html = join(DIRS.cards, `_${shot.id}.html`);
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8">${fontCss}<style>${TOKENS}${css}</style></head><body>${body}</body></html>`);

  const { chromium } = await playwright();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => ['vi', 'en'].filter((id) => document.getElementById(id).getBoundingClientRect().bottom > 1080 - 150));
  if (overflow.length) throw new Error(`voice-note card: ${overflow.join(', ')} runs into the caption band`);
  const n = Math.round(shot.dur * 30);
  const ff = spawn('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', '-an', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`voice-note encode failed (${c})`)))));
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.setT(t), i / 30);
    const png = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i === Math.round(shot.hook.at * 30) + 15) await page.screenshot({ path: join(DIRS.cards, `${shot.id}-hook.png`) });
  }
  ff.stdin.end();
  await done;
  await browser.close();
  log(`voice-note card: ${n} frames, speech ${speech.toFixed(2)} s from ${v.start} s, ${voiceFile ? 'envelope from the voice file' : 'synthetic envelope'}`);
  return { words: times, speech };
}
