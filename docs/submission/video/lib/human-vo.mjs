// --vo-file / --vo-dir: a human narrator instead of the TTS lines (Mrs. Lan's voice note stays the cached AI file).
//   --vo-file <rec>   one recording of every narrator line in timeline order, >= 2 s of silence between lines
//   --vo-dir <dir>    one file per line, named <ID>.<ext> (N1.m4a, V5a.wav, ...); with --vo-file these replace single lines
//   --vo-map "1,2,3+4,5,..."  which detected segments make each line, when the split does not find one segment per line
//   --vo-max-tempo <x> the largest pitch-preserving speed-up for a line that runs over its window (default 1.08)
// The recording is cleaned for a phone (high-pass, light FFT denoise, light compression), split at the silences,
// trimmed to 80 ms pads, set to one loudness per line and fitted to the windows in timeline.json. Lines never overlap:
// a long line is sped up a little, then pushes the next line later if there is room, else the build stops with the
// lines to read again.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, parse } from 'node:path';
import { OUT, ffmpeg, log, probeDuration, tc } from './common.mjs';
import { loudness } from './sound.mjs';
import { generateVo, pausesIn } from './vo.mjs';

const PAD = 0.08; // silence kept before and after each line
const TAIL = 0.06; // extra after the last window above the threshold (soft consonants)
const GAP = 0.25; // least silence between two lines in the mix
const MAX_SHIFT = 1.2; // a line may start at most this much later than timeline.json says
const INNER_GAP = 0.6; // a pause inside a line made of several segments is cut to this
const LUFS = Number(process.env.VO_HUMAN_LUFS ?? -29); // per line; the Draft 6 TTS lines measure −29 LUFS
const WIN = 0.02;

/** 20 ms RMS windows (dBFS) of a file, at 16 kHz mono. */
function envelope(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${r.stderr}`);
  const n = Math.floor(r.stdout.length / 2);
  const w = Math.round(16000 * WIN);
  const db = [];
  for (let i = 0; i + w <= n; i += w) {
    let s = 0;
    for (let k = i; k < i + w; k++) {
      const v = r.stdout.readInt16LE(k * 2) / 32768;
      s += v * v;
    }
    db.push(Math.max(-90, 10 * Math.log10(s / w + 1e-12)));
  }
  return db;
}

/** Noise floor, speech level and the speech threshold between them. */
export function levels(db) {
  const sorted = [...db].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const floor = q(0.1);
  const speech = q(0.95);
  // 12 dB over the room, but never lower than 35 dB under the voice (a silent studio file) nor closer than 12 dB to it.
  const threshold = Math.min(Math.max(floor + 12, speech - 35), speech - 12);
  return { floor, speech, threshold };
}

/** Speech segments [{start, end}] (seconds): runs above the threshold, joined across silences shorter than minGap. */
export function segmentsOf(db, threshold, minGap) {
  let runs = [];
  let open = null;
  db.forEach((v, i) => {
    if (v > threshold) open ??= i;
    else if (open != null) runs.push([open, i]), (open = null);
  });
  if (open != null) runs.push([open, db.length]);
  // Clicks: a run under 60 ms with 0.3 s of silence on both sides.
  runs = runs.filter(([a, b], i) => (b - a) * WIN >= 0.06 || (i > 0 && (a - runs[i - 1][1]) * WIN < 0.3) || (i < runs.length - 1 && (runs[i + 1][0] - b) * WIN < 0.3));
  const segs = [];
  for (const [a, b] of runs) {
    const last = segs.at(-1);
    if (last && a * WIN - last.end < minGap) last.end = b * WIN;
    else segs.push({ start: a * WIN, end: b * WIN });
  }
  return segs.filter((s) => s.end - s.start >= 0.3); // a cough or a thump is not a line
}

const table = (rows) => {
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((x, c) => (c === 0 ? String(x).padEnd(w[c]) : String(x).padStart(w[c]))).join('  ')).join('\n');
};
const segTable = (segs, db, thr) =>
  table([
    ['#', 'start', 'end', 'seconds', 'silence after', 'longest pause inside'],
    ...segs.map((s, i) => {
      const p = longestPause(db, thr, s);
      return [i + 1, s.start.toFixed(2), s.end.toFixed(2), (s.end - s.start).toFixed(2), i < segs.length - 1 ? (segs[i + 1].start - s.end).toFixed(2) : '', p ? `${(p[1] - p[0]).toFixed(2)} s at ${p[0].toFixed(2)}` : ''];
    }),
  ]);

/** The longest silence inside a segment, [start, end] in seconds, or null. */
function longestPause(db, threshold, seg) {
  let best = null;
  let open = null;
  for (let i = Math.round(seg.start / WIN); i < Math.round(seg.end / WIN); i++) {
    if (db[i] <= threshold) open ??= i;
    else if (open != null) {
      if (!best || i - open > best[1] - best[0]) best = [open, i];
      open = null;
    }
  }
  return best && best.map((x) => x * WIN);
}

/** "1,2,3+4,5a,5b" → the pieces of each line. "3+4" joins two segments; "5a" / "5b" are segment 5 cut at its longest pause. */
function parseMap(map, segs, nLines, db, threshold) {
  let prevHi = -1;
  const groups = map.split(',').map((g) =>
    g.trim().split('+').map((tok) => {
      const m = /^(\d+)([ab])?$/.exec(tok.trim());
      const i = m ? Number(m[1]) - 1 : -1;
      if (!m || i < 0 || i >= segs.length) throw new Error(`--vo-map: "${tok}" is not a segment (1–${segs.length}, or e.g. 6a / 6b for the two halves of segment 6)`);
      const [lo, hi] = m[2] === 'a' ? [2 * i, 2 * i] : m[2] === 'b' ? [2 * i + 1, 2 * i + 1] : [2 * i, 2 * i + 1];
      if (lo <= prevHi) throw new Error(`--vo-map must list the segments in rising order ("${tok}" is out of place)`);
      prevHi = hi;
      if (!m[2]) return segs[i];
      const pause = longestPause(db, threshold, segs[i]);
      if (!pause) throw new Error(`--vo-map: segment ${i + 1} has no pause to cut at`);
      return m[2] === 'a' ? { start: segs[i].start, end: pause[0] } : { start: pause[1], end: segs[i].end };
    }),
  );
  if (groups.length !== nLines) throw new Error(`--vo-map has ${groups.length} entries, the timeline has ${nLines} lines`);
  return groups;
}

/** Splits one recording into `ids.length` lines; returns [[{start, end}, …] per line] or throws with the table. */
function splitRecording(db, lv, ids, map, expect) {
  let segs = segmentsOf(db, lv.threshold, 1.2);
  let groups = null;
  const example = () => {
    const n = segs.length;
    if (n > ids.length) return Array.from({ length: n }, (_, i) => i + 1).join(',').replace(/^1,2,/, '1+2,') + '   (joins 1 and 2; with more to join or skip, adapt)';
    const longest = segs.reduce((b, s, i) => (s.end - s.start > segs[b].end - segs[b].start ? i : b), 0);
    return Array.from({ length: n }, (_, i) => (i === longest ? `${i + 1}a,${i + 1}b` : i + 1)).join(',') + `   (cuts segment ${longest + 1} in two at its longest pause)`;
  };
  const hint = () =>
    `Detected ${segs.length} segments, the timeline has ${ids.length} narrator lines (${ids.join(', ')}).\n` +
    `noise floor ${lv.floor.toFixed(0)} dB, speech ${lv.speech.toFixed(0)} dB, threshold ${lv.threshold.toFixed(0)} dB, least gap 1.2 s\n\n${segTable(segs, db, lv.threshold)}\n\n` +
    `Expected lengths (Draft 6 TTS, for orientation): ${ids.map((id, i) => `${id} ${expect[i]}`).join(' · ')}\n` +
    `Say which segments make each line with --vo-map, ${ids.length} comma-separated entries in line order; "3+4" joins two segments, "6a,6b" cuts segment 6 in two at its longest pause, a number left out is skipped.\n` +
    `  e.g. --vo-map "${example().replace('   (', '"   (')}`;
  if (map) {
    groups = parseMap(map, segs, ids.length, db, lv.threshold);
  } else if (segs.length < ids.length) {
    // Pauses shorter than asked for: try a smaller least gap before giving up.
    for (const g of [1.0, 0.8]) {
      const s = segmentsOf(db, lv.threshold, g);
      if (s.length === ids.length) {
        log(`human VO: ${ids.length} lines only with a least gap of ${g} s (the pauses between lines are short); check the fit table`);
        segs = s;
        break;
      }
    }
    if (segs.length !== ids.length) throw new Error(`could not split the recording into ${ids.length} lines.\n${hint()}`);
  } else if (segs.length > ids.length) {
    // Long pauses inside a line: join across the shortest silences if they are clearly shorter than the rest.
    const gaps = segs.slice(1).map((s, i) => ({ i, len: s.start - segs[i].end })).sort((a, b) => a.len - b.len);
    const drop = gaps.slice(0, segs.length - ids.length);
    if (drop.at(-1).len > 0.75 * gaps[drop.length].len) throw new Error(`could not split the recording into ${ids.length} lines.\n${hint()}`);
    const joined = new Set(drop.map((d) => d.i));
    groups = [];
    segs.forEach((_, i) => (i > 0 && joined.has(i - 1) ? groups.at(-1).push(i) : groups.push([i])));
    log(`human VO: ${segs.length} segments, joined across the ${drop.length} shortest silence(s) (${drop.map((d) => `${d.len.toFixed(2)} s after #${d.i + 1}`).join(', ')}) to make ${ids.length} lines`);
  }
  groups ??= segs.map((_, i) => [i]);
  return groups.map((g) => g.map((x) => (typeof x === 'number' ? segs[x] : x)));
}

/** Cleans one source file to 48 kHz mono WAV: high-pass, light denoise at the measured floor, light compression. */
function clean(src, out, floor) {
  const nf = Math.max(-80, Math.min(-20, Math.round(floor + 3)));
  const af = `highpass=f=80,afftdn=nr=10:nf=${nf}:tn=0,acompressor=threshold=-24dB:ratio=2.5:attack=8:release=160:makeup=1`;
  ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', '48000', '-af', af, '-c:a', 'pcm_s16le', out]);
}

/** Cuts the pieces of one line out of a cleaned file, with pads and short fades; inner pauses capped. */
function cut(cleaned, pieces, out) {
  const f = [];
  pieces.forEach((p, k) => {
    const first = k === 0;
    const last = k === pieces.length - 1;
    const a = Math.max(0, p.start - (first ? PAD : 0.03));
    const b = p.end + TAIL + (last ? PAD : 0.03);
    const d = b - a;
    const gap = last ? 0 : Math.max(0, Math.min(INNER_GAP, pieces[k + 1].start - p.end) - 0.06 - TAIL);
    f.push(`[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.03,afade=t=out:st=${(d - 0.05).toFixed(3)}:d=0.05${gap ? `,apad=pad_dur=${gap.toFixed(3)}` : ''}[p${k}]`);
  });
  f.push(`${pieces.map((_, k) => `[p${k}]`).join('')}concat=n=${pieces.length}:v=0:a=1[a]`);
  ffmpeg(['-i', cleaned, '-filter_complex', f.join(';'), '-map', '[a]', '-c:a', 'pcm_s16le', out]);
}

/**
 * Places the lines: nominal start, or later if the line before runs long. `lines` = [{id, start, window, dur}] with
 * `dur` after any speed-up; `fixed` = [[a, b], …] other voices (Mrs. Lan); `total` = video seconds.
 * Returns { rows: [{id, start, shift, problem?}], ok }.
 */
export function place(lines, fixed, total) {
  let prevEnd = -Infinity;
  const rows = lines.map((l) => {
    let start = Math.max(l.start, prevEnd + GAP);
    for (const [a, b] of fixed) if (start < b + 0.2 && start + l.dur > a - 0.2 && l.start >= a) start = Math.max(start, b + 0.2);
    const end = start + l.dur;
    const limit = Math.min(total - 0.2, ...fixed.filter(([a]) => l.start < a).map(([a]) => a - 0.2));
    const shift = +(start - l.start).toFixed(3);
    let problem = null;
    if (end > limit + 1e-6) problem = `ends ${(end - limit).toFixed(2)} s past ${limit === total - 0.2 ? 'the end of the video' : "Mrs. Lan's voice note"}`;
    else if (shift > MAX_SHIFT) problem = `would start ${shift.toFixed(2)} s late`;
    prevEnd = end;
    return { id: l.id, start: +start.toFixed(3), end: +end.toFixed(3), shift, problem };
  });
  return { rows, ok: rows.every((r) => !r.problem) };
}

/**
 * The human narration, fitted. Mutates T.vo (start, end, window) for the lines that had to move, so the captions and
 * the EDL follow. Returns what generateVo returns, plus `fit` (the table rows).
 */
export async function humanVo(T, { file, dir, map, maxTempo = 1.08, total }) {
  const work = join(OUT, 'vo-human');
  mkdirSync(work, { recursive: true });
  const ids = T.vo.map((v) => v.id);
  const sources = {}; // id → { cleaned, pieces }
  const prep = (src, name) => {
    if (!existsSync(src)) throw new Error(`no such file: ${src}`);
    const db = envelope(src);
    const lv = levels(db);
    const cleaned = join(work, `_clean-${name}.wav`);
    clean(src, cleaned, lv.floor);
    return { db, lv, cleaned };
  };
  if (file) {
    const { db, lv, cleaned } = prep(file, 'all');
    log(`human VO: ${file} · ${(db.length * WIN).toFixed(1)} s · noise floor ${lv.floor.toFixed(0)} dB, speech ${lv.speech.toFixed(0)} dB, threshold ${lv.threshold.toFixed(0)} dB`);
    if (lv.speech - lv.floor < 20) log(`WARNING the voice is only ${(lv.speech - lv.floor).toFixed(0)} dB over the room noise; the split may be unreliable. Record closer to the phone, in a quieter room`);
    const groups = splitRecording(db, lv, ids, map, T.vo.map((v) => `${Math.min(v.window, v.estSeconds).toFixed(0)} s`));
    ids.forEach((id, i) => (sources[id] = { cleaned, pieces: groups[i] }));
  }
  if (dir) {
    for (const f of readdirSync(dir).sort()) {
      const id = parse(f).name;
      if (!ids.includes(id) || !/\.(m4a|mp3|wav|ogg|oga|opus|webm|aac|flac|mp4)$/i.test(f)) continue;
      const { db, lv, cleaned } = prep(join(dir, f), id);
      const segs = segmentsOf(db, lv.threshold, 1.2);
      if (!segs.length) throw new Error(`${join(dir, f)}: no speech found`);
      // One file is one line: everything from the first word to the last.
      sources[id] = { cleaned, pieces: [{ start: segs[0].start, end: segs.at(-1).end }] };
      if (file) log(`human VO: ${id} taken from ${join(dir, f)}`);
    }
  }
  const missing = ids.filter((id) => !sources[id]);
  if (missing.length) throw new Error(`no recording for ${missing.join(', ')} (--vo-dir needs one file per line, named <ID>.<ext>; or give the whole read with --vo-file)`);

  // Mrs. Lan's voice note: the cached AI file, untouched.
  const ai = await generateVo(T, { only: ['lan_voice'] });
  const lan = ai.files[0];
  const fixed = [[lan.start, lan.start + ai.durations.lan_voice]];

  // Cut, level, and speed up the lines that run over their window (never beyond maxTempo).
  const lines = T.vo.map((v) => {
    const raw = join(work, `_raw-${v.id}.wav`);
    cut(sources[v.id].cleaned, sources[v.id].pieces, raw);
    const rawDur = probeDuration(raw);
    const speech = rawDur - 2 * PAD;
    const over = speech - v.window;
    const tempo = over > 0.05 ? Math.min(maxTempo, speech / v.window) : 1;
    const gain = LUFS - loudness(raw).I;
    const out = join(work, `${v.id}.wav`);
    ffmpeg(['-i', raw, '-af', `volume=${gain.toFixed(2)}dB${tempo > 1 ? `,atempo=${tempo.toFixed(4)}` : ''},alimiter=limit=0.5:attack=3:release=50:level=false`, '-c:a', 'pcm_s16le', out]);
    return { id: v.id, file: out, start: v.start, window: v.window, speech, tempo, dur: probeDuration(out) - 2 * PAD, over };
  });
  // In the mix a file starts PAD before its speech; place by speech, so `start` is where the first word lands − PAD.
  const placed = place(lines.map((l) => ({ ...l, dur: l.dur })), fixed, total);

  const fit = lines.map((l, i) => {
    const p = placed.rows[i];
    const stillOver = l.dur - l.window;
    const status = p.problem
      ? `FAIL ${p.problem}`
      : [l.over <= 0.05 ? 'OK' : `OVER by ${l.over.toFixed(2)} s`, l.tempo > 1 ? `sped up ×${l.tempo.toFixed(3)}` : '', stillOver > 0.05 ? `runs ${stillOver.toFixed(2)} s into the gap after it` : '', p.shift > 0 ? `starts ${p.shift.toFixed(2)} s late` : ''].filter(Boolean).join(', ');
    return { id: l.id, speechSeconds: +l.speech.toFixed(2), window: l.window, tempo: +l.tempo.toFixed(3), fittedSeconds: +l.dur.toFixed(2), start: p.start, shift: p.shift, status };
  });
  console.log(`\nHuman VO fit (speech seconds against the windows in timeline.json):\n${table([['id', 'speech', 'window', 'fitted', 'start', 'status'], ...fit.map((r) => [r.id, r.speechSeconds.toFixed(2), r.window.toFixed(2), r.fittedSeconds.toFixed(2), tc(r.start), r.status])])}\n`);
  if (!placed.ok) {
    // Blame the lines that are still over their window in the run of late lines leading to each failure.
    const blame = new Set();
    placed.rows.forEach((p, i) => {
      if (!p.problem) return;
      let found = false;
      for (let k = i; k >= 0; k--) {
        if (lines[k].dur > lines[k].window + 0.05) blame.add(k), (found = true);
        if (placed.rows[k].shift <= 0) break;
      }
      if (!found) blame.add(i);
    });
    const list = [...blame].sort((a, b) => a - b).map((k) => `  ${lines[k].id}: ${lines[k].speech.toFixed(2)} s spoken, window ${lines[k].window} s → read it in ${lines[k].window.toFixed(1)} s or less`);
    throw new Error(`the narration does not fit without overlapping. Read these lines again, faster (send them as <ID>.m4a in a folder and add --vo-dir <folder>), or allow more speed-up with --vo-max-tempo 1.15:\n${list.join('\n')}`);
  }

  // The captions, the EDL and the mix follow the placed starts.
  const files = [];
  const durations = { lan_voice: ai.durations.lan_voice };
  const pauses = { lan_voice: ai.pauses.lan_voice };
  T.vo.forEach((v, i) => {
    const l = lines[i];
    const p = placed.rows[i];
    v.start = p.start;
    v.end = Math.max(v.end, p.end);
    v.window = +(v.end - v.start).toFixed(2);
    durations[v.id] = l.dur;
    pauses[v.id] = pausesIn(l.file).map(([a, b]) => [Math.max(0, a - PAD), b - PAD]);
    files.push({ id: v.id, file: l.file, start: Math.max(0, p.start - PAD) });
  });
  files.push(lan);
  return { files, durations, pauses, fit };
}
