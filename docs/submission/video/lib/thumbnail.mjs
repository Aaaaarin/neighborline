// Thumbnail per THUMBNAIL_BRIEF.md: Mrs. Lan's real phone in its paid state (cropped from the recorded take at its
// DPR) on --paper, "Voice note → cash" and the frozen stopwatch in --lamp-display. 1280×720 (YouTube) + 1500×1000 (Devpost).
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { DIRS, OUT, ffmpeg } from './common.mjs';

export async function renderThumbnails(render, take) {
  const d = take.dpr;
  // The phone body only (its 392×814 CSS-px frame, no page background), at the frozen paid moment + 6 s.
  const phonePng = join(DIRS.stills, 'lan-paid-phone.png');
  const t = take.playAt + take.ev.success + 6;
  ffmpeg(['-ss', String(t), '-i', join(DIRS.takes, 'lan.mp4'), '-frames:v', '1', '-vf', `crop=${Math.round(392 * d)}:${Math.round(814 * d)}:${Math.round(32 * d)}:${Math.round(137 * d)}`, phonePng]);
  const img = pathToFileURL(phonePng).href;
  const clock = take.clock;
  const body = (W, H) => {
    const ph = Math.round(H * 0.9);
    return `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 0% 0%,rgba(214,226,234,.55),transparent 38%),radial-gradient(ellipse at 100% 0%,rgba(214,226,234,.45),transparent 34%),var(--paper)"></div>
<img src="${img}" style="position:absolute;left:${Math.round(W * 0.07)}px;top:${Math.round((H - ph) / 2)}px;height:${ph}px;border-radius:${Math.round((ph * 52) / 814)}px;box-shadow:0 ${Math.round(H * 0.04)}px ${Math.round(H * 0.08)}px rgba(27,34,48,.22),0 ${Math.round(H * 0.01)}px ${Math.round(H * 0.02)}px rgba(27,34,48,.12)">
<div style="position:absolute;left:${Math.round(W * 0.43)}px;top:${Math.round(H * 0.1)}px">
<p class="serif" style="font-size:${Math.round(H * 0.135)}px;font-weight:600;line-height:1.04;letter-spacing:-0.015em">Voice note<br>→ cash</p>
<p style="font-size:${Math.round(H * 0.31)}px;font-weight:400;letter-spacing:-0.045em;line-height:1;margin-top:${Math.round(H * 0.06)}px;color:var(--lamp-display);font-variant-numeric:tabular-nums">${clock}</p></div>`;
  };
  await render('thumbnail', body(1280, 720), { w: 1280, h: 720, dir: OUT });
  await render('thumbnail-1500x1000', body(1500, 1000), { w: 1500, h: 1000, dir: OUT });
  for (const [w, h] of [[300, 169], [168, 94]]) ffmpeg(['-i', join(OUT, 'thumbnail.png'), '-vf', `scale=${w}:${h}:flags=lanczos`, join(DIRS.frames, `thumbnail-${w}.png`)]);
}
