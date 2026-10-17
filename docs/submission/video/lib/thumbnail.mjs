// Thumbnail per THUMBNAIL_BRIEF.md: Mrs. Lan's real phone in its paid state (cropped from the recorded take at its
// DPR) on --paper, "Voice note → cash" and the frozen stopwatch in --lamp-display. 1280×720 (YouTube) + 1500×1000 (Devpost).
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { DIRS, OUT, ffmpeg } from './common.mjs';

export async function renderThumbnails(render, take, page) {
  const d = take.dpr;
  // The phone body only (its 392×814 CSS-px frame, no page background), at the frozen paid moment + 6 s.
  const phonePng = join(DIRS.stills, 'lan-paid-phone.png');
  const t = take.playAt + take.ev.success + 6;
  ffmpeg(['-ss', String(t), '-i', join(DIRS.takes, 'lan.mp4'), '-frames:v', '1', '-vf', `crop=${Math.round(392 * d)}:${Math.round(814 * d)}:${Math.round(32 * d)}:${Math.round(137 * d)}`, phonePng]);
  const img = pathToFileURL(phonePng).href;
  const clock = take.clock;
  // Laid out from the phone outwards so the text column always fits the frame: on the 3:2 card the old
  // H-relative sizes pushed the stopwatch's last digit past the right edge. The stopwatch is then shrunk
  // in the browser (after the web fonts load) until it fits its column, and the render fails if it can't.
  const body = (W, H) => {
    const ph = Math.round(H * 0.9);
    const phoneLeft = Math.round(W * 0.064);
    const phoneRight = phoneLeft + Math.round((ph * 392) / 814);
    const left = phoneRight + Math.round(W * 0.06);
    const width = W - left - Math.round(W * 0.04);
    const title = Math.min(Math.round(H * 0.135), Math.round(width * 0.161));
    return `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 0% 0%,rgba(214,226,234,.55),transparent 38%),radial-gradient(ellipse at 100% 0%,rgba(214,226,234,.45),transparent 34%),var(--paper)"></div>
<img src="${img}" style="position:absolute;left:${phoneLeft}px;top:${Math.round((H - ph) / 2)}px;height:${ph}px;border-radius:${Math.round((ph * 52) / 814)}px;box-shadow:0 ${Math.round(H * 0.04)}px ${Math.round(H * 0.08)}px rgba(27,34,48,.22),0 ${Math.round(H * 0.01)}px ${Math.round(H * 0.02)}px rgba(27,34,48,.12)">
<div style="position:absolute;left:${left}px;top:${Math.round(H * 0.12)}px;width:${width}px">
<p class="serif" style="font-size:${title}px;font-weight:600;line-height:1.04;letter-spacing:-0.015em">Voice note<br>→ cash</p>
<p id="clock" data-max="${width}" style="display:inline-block;white-space:nowrap;font-size:${Math.round(H * 0.31)}px;font-weight:400;letter-spacing:-0.045em;line-height:1;margin-top:${Math.round(H * 0.05)}px;color:var(--lamp-display);font-variant-numeric:tabular-nums">${clock}</p></div>
<script>document.fonts.ready.then(() => {
  const el = document.getElementById('clock');
  const max = Number(el.dataset.max);
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.getBoundingClientRect().width > max && size > 20) el.style.fontSize = (size -= 2) + 'px';
  const r = el.getBoundingClientRect();
  document.body.dataset.fit = r.right <= innerWidth && r.width <= max ? 'ok' : 'overflow';
});</script>`;
  };
  for (const [name, w, h] of [['thumbnail', 1280, 720], ['thumbnail-1500x1000', 1500, 1000]]) {
    await render(name, body(w, h), { w, h, dir: OUT });
    const fit = page ? await page.evaluate(() => document.body.dataset.fit) : 'ok';
    if (fit !== 'ok') throw new Error(`thumbnail ${name}: the stopwatch does not fit its column (${fit ?? 'not measured'})`);
  }
  for (const [w, h] of [[300, 169], [168, 94]]) ffmpeg(['-i', join(OUT, 'thumbnail.png'), '-vf', `scale=${w}:${h}:flags=lanczos`, join(DIRS.frames, `thumbnail-${w}.png`)]);
}
