// QA frames: every shot boundary (+0.4 s in, −0.3 s before the cut), every 10 s, and a contact sheet.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS, ffmpeg, log, probeDuration } from './common.mjs';

export function qa(video, T) {
  for (const f of readdirSync(DIRS.frames)) if (/^(f|s)_.*\.png$|^contact\.png$/.test(f)) rmSync(join(DIRS.frames, f));
  const dur = probeDuration(video);
  const pts = new Map();
  for (const s of T.shots) {
    pts.set(`s_${s.id}_in`, s.start + 0.4);
    pts.set(`s_${s.id}_out`, Math.min(dur - 0.05, s.end - 0.3));
  }
  for (let t = 0; t < dur; t += 10) pts.set(`f_${String(t).padStart(3, '0')}s`, t + 0.05);
  for (const [name, t] of pts) ffmpeg(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', join(DIRS.frames, `${name}.png`)]);
  ffmpeg(['-i', video, '-vf', 'fps=1/4,scale=480:-1,tile=6x8', '-frames:v', '1', join(DIRS.frames, 'contact.png')]);
  log(`QA: ${pts.size} frames + contact sheet in ${DIRS.frames}`);
}
