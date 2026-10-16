// Builds one silent 1920×1080/30 fps segment per shot (segs/<id>.mp4) with ffmpeg.
// Crop boxes are CSS px on the 1920×1080 stage (multiplied by the take's DPR); placements are output px.
import { join } from 'node:path';
import { DIRS, ffmpeg } from './common.mjs';

export const PAPER = '0xEFF1EE';
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', '-an'];

/** Composition layouts. `src` crops are CSS px; `at` is the output position; size by h or w. */
export const LAYOUT = {
  A: {
    parts: [
      // Crops reach past the phone's soft shadow (and off the bottom of the frame), so no hard crop edges show.
      { name: 'phone', src: { x: 4, y: 92, w: 464, h: 988 }, at: { x: 227, y: 80 }, k: 1.134 },
      { name: 'clock', src: { x: 1320, y: 92, w: 576, h: 262 }, at: { x: 800, y: 120 }, k: 1.7, maskIdle: { y0: 288, y1: 354 } },
    ],
    lt: { x: 820, y: 640, w: 1000 },
    caption: { style: 'R', marginL: 820 },
    focus: { phone: { x: 482, y: 830 } },
  },
  B: {
    parts: [
      { name: 'phones', src: { x: 8, y: 92, w: 1292, h: 988 }, at: { x: 14, y: 78 }, k: 0.95 },
      { name: 'clock', src: { x: 1320, y: 92, w: 576, h: 262 }, at: { x: 1300, y: 96 }, k: 1.0, maskIdle: { y0: 288, y1: 354 } },
    ],
    lt: { x: 1300, y: 470, w: 580 },
    caption: { style: 'C' },
  },
  C: {
    parts: [
      { name: 'phones', src: { x: 4, y: 92, w: 870, h: 988 }, at: { x: 20, y: 80 }, k: 1.134 },
      { name: 'zoom', src: { x: 500, y: 394, w: 338, h: 202 }, at: { x: 1110, y: 92 }, k: 2.0, border: true },
    ],
    lt: { x: 1110, y: 720, w: 760 },
    handles: { x: 1110, y: 520 },
    caption: { style: 'R', marginL: 1110 },
  },
  framed: { frame: { x: 192, y: 64, w: 1536, h: 864 }, lt: { x: 1180, y: 96, w: 520 }, caption: { style: 'C' } },
  card: { lt: { x: 150, bottom: 170, w: 1200 }, caption: { style: 'C' } },
};

/** filter_complex that composes `layout` from input [0:v] (a take at `dpr`) onto a paper background. */
function composeFilter(layout, dpr, dur, label = 'v', idleUntil = -1) {
  const n = layout.parts.length;
  const f = [`color=c=${PAPER}:s=1920x1080:r=30:d=${dur}[bg]`, `[0:v]fps=30,split=${n}${layout.parts.map((_, i) => `[p${i}]`).join('')}`];
  layout.parts.forEach((p, i) => {
    const s = p.src;
    const W = Math.round((s.w * p.k) / 2) * 2;
    const H = Math.round((s.h * p.k) / 2) * 2;
    // While the clock is idle its block is shorter and the rail header would show: paint it out (no dashboard early).
    const mask = p.maskIdle && idleUntil > 0 ? `,drawbox=x=0:y=${Math.round((p.maskIdle.y0 - s.y) * p.k)}:w=iw:h=${Math.round((p.maskIdle.y1 - p.maskIdle.y0) * p.k) + 2}:color=${PAPER}:t=fill:enable='lt(t,${idleUntil.toFixed(3)})'` : '';
    const border = p.border ? `,drawbox=x=0:y=0:w=iw:h=ih:color=0xCDD3D1:t=2` : '';
    f.push(`[p${i}]crop=${s.w * dpr}:${s.h * dpr}:${s.x * dpr}:${s.y * dpr},scale=${W}:${H}:flags=lanczos${mask}${border}[q${i}]`);
  });
  let prev = 'bg';
  layout.parts.forEach((p, i) => {
    const out = i === n - 1 ? `${label}0` : `o${i}`;
    f.push(`[${prev}][q${i}]overlay=${p.at.x}:${p.at.y}:shortest=1${i === n - 1 ? ',format=yuv420p' : ''}[${out}]`);
    prev = out;
  });
  return f;
}

/**
 * Slow push-in toward a focus point (fractions fx, fy of the input), eased, output W×H. zoompan keeps the output
 * size fixed per frame; the input is upscaled 2× first so its integer crop steps stay sub-pixel in the output.
 */
function pushFilter(inLabel, outLabel, dur, to, { fx, fy }, W = 1920, H = 1080, upscale = true) {
  const z = `1+${(to - 1).toFixed(4)}*(1-cos(PI*min(on/30/${dur},1)))/2`;
  const pre = upscale ? `scale=iw*2:ih*2:flags=lanczos,` : '';
  return `[${inLabel}]${pre}zoompan=z='${z}':x='(iw-iw/zoom)*${fx.toFixed(4)}':y='(ih-ih/zoom)*${fy.toFixed(4)}':d=1:s=${W}x${H}:fps=30,setsar=1[${outLabel}]`;
}

export function takeSegment(shot, take, file) {
  const layout = LAYOUT[shot.comp];
  // Local time at which the stage leaves idle (Play + ~0.3 s for request.created to reach the page).
  const idleUntil = take.playAt + (take.ev.created ?? 0) + 0.3 - shot.srcStart;
  const f = composeFilter(layout, take.dpr, shot.dur, 'v', idleUntil);
  let last = 'v0';
  if (shot.push) {
    const focus = layout.focus?.[shot.push.focus] ?? { x: 960, y: 540 };
    f.push(pushFilter('v0', 'v1', shot.dur, shot.push.to, { fx: focus.x / 1920, fy: focus.y / 1080 }));
    last = 'v1';
  }
  ffmpeg(['-ss', String(shot.srcStart), '-t', String(shot.dur), '-i', join(DIRS.takes, `${take.id}.mp4`), '-filter_complex', f.join(';'), '-map', `[${last}]`, '-t', String(shot.dur), ...ENC, file]);
}

/** A full-screen card (title / code) with an optional fade and a 2 % push-in. */
export function cardSegment(shot, png, file) {
  const fades = [];
  if (shot.fadeIn) fades.push(`fade=t=in:st=0:d=${shot.fadeIn}:color=${PAPER}`);
  if (shot.fadeOut) fades.push(`fade=t=out:st=${(shot.dur - shot.fadeOut).toFixed(2)}:d=${shot.fadeOut}:color=${PAPER}`);
  const push = pushFilter('0:v', 'p', shot.dur, 1.02, { fx: 0.5, fy: 0.5 }).replace(/^\[0:v\]/, '').replace(/\[p\]$/, '');
  const chain = [`fps=30`, push, ...fades, 'format=yuv420p'].join(',');
  ffmpeg(['-loop', '1', '-framerate', '30', '-t', String(shot.dur), '-i', png, '-vf', chain, '-t', String(shot.dur), ...ENC, file]);
}

/**
 * Pan a tall full-page still inside the frame. `stillScaled` is pre-scaled to frame width.
 * `y0`/`y1` are top offsets in that scaled image; holds `hold` s, then eases to y1.
 */
export function panSegment(shot, stillScaled, y0, y1, file, hold = 0) {
  const fr = LAYOUT.framed.frame;
  const move = Math.max(0.1, shot.dur - hold - 0.5);
  const p = `min(max((t-${hold})/${move},0),1)`;
  const y = `${y0}+(${y1 - y0})*(1-cos(PI*${p}))/2`;
  const f = [
    `color=c=${PAPER}:s=1920x1080:r=30:d=${shot.dur}[bg]`,
    `[0:v]fps=30,crop=${fr.w}:${fr.h}:0:'${y}'[c]`,
    `color=c=0xCDD3D1:s=${fr.w + 2}x${fr.h + 2}:r=30:d=${shot.dur}[rule]`,
    `[bg][rule]overlay=${fr.x - 1}:${fr.y - 1}[b2]`,
    `[b2][c]overlay=${fr.x}:${fr.y}:shortest=1,format=yuv420p[v]`,
  ];
  ffmpeg(['-loop', '1', '-framerate', '30', '-t', String(shot.dur), '-i', stillScaled, '-filter_complex', f.join(';'), '-map', '[v]', '-t', String(shot.dur), ...ENC, file]);
}

/** The finished stage, framed, pushing toward the PayPal rail. `still` is the take's last frame (DPR px). */
export function stageEndSegment(shot, still, dpr, file) {
  const fr = LAYOUT.framed.frame;
  // Toward the rail column (x ≈ 1612 of 1920 CSS px), a little below the stopwatch.
  const f = [
    `color=c=${PAPER}:s=1920x1080:r=30:d=${shot.dur}[bg]`,
    pushFilter('0:v', 'c', shot.dur, shot.push.to, { fx: 0.97, fy: 0.8 }, fr.w, fr.h, dpr < 2),
    `color=c=0xCDD3D1:s=${fr.w + 2}x${fr.h + 2}:r=30:d=${shot.dur}[rule]`,
    `[bg][rule]overlay=${fr.x - 1}:${fr.y - 1}[b2]`,
    `[b2][c]overlay=${fr.x}:${fr.y}:shortest=1,format=yuv420p[v]`,
  ];
  ffmpeg(['-loop', '1', '-framerate', '30', '-t', String(shot.dur), '-i', still, '-filter_complex', f.join(';'), '-map', '[v]', '-t', String(shot.dur), ...ENC, file]);
}

/** Composition A on Lan's last frame; the end card cross-fades over the stopwatch, the porch light lights later. */
export function endSegment(shot, take, still, endPng, endLitPng, litAtLocal, file) {
  const f = composeFilter(LAYOUT.A, take.dpr, shot.dur, 'v');
  f.push(`[1:v]format=rgba,fade=t=in:st=${shot.crossfadeAt}:d=0.32:alpha=1[e]`);
  f.push(`[v0][e]overlay=0:0:shortest=1[v1]`);
  f.push(`[2:v]format=rgba[l]`, `[v1][l]overlay=0:0:enable='gte(t,${litAtLocal})',format=yuv420p[v]`);
  ffmpeg([
    '-loop', '1', '-framerate', '30', '-t', String(shot.dur), '-i', still,
    '-loop', '1', '-framerate', '30', '-t', String(shot.dur), '-i', endPng,
    '-loop', '1', '-framerate', '30', '-t', String(shot.dur), '-i', endLitPng,
    '-filter_complex', f.join(';'), '-map', '[v]', '-t', String(shot.dur), ...ENC, file,
  ]);
}
