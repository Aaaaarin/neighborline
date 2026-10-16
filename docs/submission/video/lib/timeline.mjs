// Resolves timeline.json against the recorded takes: event anchors, {T} placeholders, VO fit, caption cues.
import { join } from 'node:path';
import { DIRS, HERE, readJson, secs, tc } from './common.mjs';

const EVENT_NAMES = {
  created: (e) => e.type === 'request.created',
  transcribed: (e) => e.type === 'request.transcribed',
  readback: (e) => e.type === 'request.readback',
  confirmed: (e) => e.type === 'request.confirmed',
  approval1: (e, i, all) => e.type === 'approval.added' && all.filter((x) => x.type === 'approval.added').indexOf(e) === 0,
  approval2: (e, i, all) => e.type === 'approval.added' && all.filter((x) => x.type === 'approval.added').indexOf(e) === 1,
  batch: (e) => e.type === 'payout.batch_created',
  unclaimed: (e) => e.type === 'payout.item_updated' && e.status === 'UNCLAIMED',
  success: (e) => e.type === 'payout.item_updated' && e.status === 'SUCCESS',
  flagged: (e) => e.type === 'request.flagged',
};

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
function words(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}
/** "0:22.9" → "Twenty-two point nine" (what the stopwatch shows, read aloud exactly). */
export function clockWords(clock) {
  const m = /^(\d+):(\d+)\.(\d)$/.exec(clock);
  if (!m) throw new Error(`unexpected stopwatch text ${clock}`);
  const s = Number(m[1]) * 60 + Number(m[2]);
  const w = `${words(s)} point ${ONES[Number(m[3])]}`;
  return w[0].toUpperCase() + w.slice(1);
}

export function loadTimeline() {
  const tl = readJson(join(HERE, 'timeline.json'));
  const takes = {};
  for (const id of ['lan', 'rosa', 'blocked']) {
    const m = readJson(join(DIRS.takes, `${id}.markers.json`));
    const ev = {};
    m.events.forEach((e, i, all) => {
      for (const [name, f] of Object.entries(EVENT_NAMES)) if (ev[name] == null && f(e, i, all)) ev[name] = +(e.t - m.playAt).toFixed(3);
    });
    takes[id] = { ...m, ev };
  }
  const mode = tl.paypalMode;
  const pick = (v) => (v && typeof v === 'object' && !Array.isArray(v) && (v.fake || v.sandbox) ? v[mode] : v);
  const vars = {
    T: takes.lan.clock,
    T_words: clockWords(takes.lan.clock),
    BLOCK_T: takes.blocked.clock,
    HOSTED_URL: process.env.HOSTED_URL ?? '{HOSTED_URL}',
  };
  const fill = (s) => (typeof s === 'string' ? s.replace(/\{(T|T_words|BLOCK_T|HOSTED_URL)\}/g, (_, k) => vars[k]) : s);

  const srcSec = (take, expr) => {
    const m = /^P([+-]\d+(?:\.\d+)?)$/.exec(expr);
    if (!m) throw new Error(`bad src ${expr}`);
    return takes[take].playAt + Number(m[1]); // seconds in the take file
  };
  const shots = tl.shots.map((s) => {
    const start = secs(s.start);
    const end = secs(s.end);
    const out = { ...s, start, end, dur: +(end - start).toFixed(3) };
    if (s.take && s.src) out.srcStart = srcSec(s.take, s.src);
    return out;
  });
  for (let i = 1; i < shots.length; i++) if (Math.abs(shots[i].start - shots[i - 1].end) > 1e-6) throw new Error(`gap/overlap between ${shots[i - 1].id} and ${shots[i].id}`);

  /** Video time at which a take event is on screen (first shot showing that moment). */
  const anchor = (a) => {
    const t = takes[a.take];
    const ev = t.ev[a.event];
    if (ev == null) throw new Error(`event ${a.event} missing in take ${a.take}`);
    const fileT = t.playAt + ev;
    const shot = shots.find((s) => s.take === a.take && s.srcStart != null && fileT >= s.srcStart && fileT < s.srcStart + s.dur);
    if (!shot) throw new Error(`event ${a.take}.${a.event} (P+${ev}) is not inside any shot`);
    return +(shot.start + (fileT - shot.srcStart) + (a.offset ?? 0)).toFixed(3);
  };
  const shotAt = (t) => shots.find((s) => t >= s.start && t < s.end) ?? shots.at(-1);

  const warnings = [];
  const vo = tl.vo.map((v) => {
    const text = fill(pick(v.text));
    const start = v.anchor ? anchor(v.anchor) : secs(v.start);
    const end = v.anchor ? Math.max(start + 1, secs(v.end) + (start - secs(v.start))) : secs(v.end);
    const nWords = text.split(/\s+/).filter(Boolean).length;
    const est = +((nWords / v.wpm) * 60).toFixed(2);
    const window = +(end - start).toFixed(2);
    const needWpm = Math.round((nWords / window) * 60);
    if (est > window + 0.05) warnings.push(`${v.id}: ${nWords} words need ${est}s at ${v.wpm} wpm but the window is ${window}s (${needWpm} wpm)`);
    return { id: v.id, text, start, end, window, words: nWords, wpm: v.wpm, estSeconds: est, fits: est <= window + 0.05, needWpm, ...(v.note ? { note: v.note } : {}) };
  });

  const lowerThirds = tl.lowerThirds.map((l) => {
    const start = l.anchor ? anchor(l.anchor) : secs(l.start);
    const end = l.until ? anchor(l.until) : l.duration ? start + l.duration : secs(l.end);
    return { ...l, title: fill(l.title), sub: fill(pick(l.sub)), start, end, comp: compOf(shotAt(start)) };
  });
  const timed = (arr) => (arr ?? []).map((x) => ({ ...x, start: secs(x.start), end: secs(x.end), text: fill(x.text) }));
  return {
    tl,
    mode,
    vars,
    takes,
    shots,
    vo,
    quotes: timed(tl.quotes),
    pills: timed(tl.pills),
    overlays: timed(tl.overlays),
    lowerThirds,
    corner: { start: secs(tl.corner.from), end: secs(tl.corner.to), text: tl.corner.text[mode] },
    endCard: Object.fromEntries(Object.entries(tl.endCard).map(([k, v]) => [k, fill(v)])),
    warnings,
    shotAt,
    anchor,
  };
}

export const compOf = (shot) => (shot.comp ?? (shot.kind === 'end' ? 'A' : shot.kind === 'pan' || shot.kind === 'stageEnd' ? 'framed' : 'card'));

// ---------- captions ----------

/** Split text into cues of ≤ 2 lines × maxLine chars, breaking at punctuation first. */
export function cueTexts(text, maxLine = 42) {
  const max = maxLine * 2;
  const wordsArr = text.split(/\s+/).filter(Boolean);
  const cues = [];
  let cur = [];
  const len = (a) => a.join(' ').length;
  for (let i = 0; i < wordsArr.length; i++) {
    const w = wordsArr[i];
    if (len([...cur, w]) > max && cur.length) {
      // Back up to the last punctuation break inside this cue if it is not too early.
      let cut = -1;
      for (let k = cur.length - 1; k >= Math.floor(cur.length / 2); k--) if (/[.,;:?!]$/.test(cur[k])) { cut = k; break; }
      if (cut >= 0 && cut < cur.length - 1) {
        cues.push(cur.slice(0, cut + 1));
        cur = cur.slice(cut + 1);
      } else {
        cues.push(cur);
        cur = [];
      }
    }
    cur.push(w);
    if (/[.?!]$/.test(w) && len(cur) > maxLine * 1.1 && i < wordsArr.length - 1) {
      cues.push(cur);
      cur = [];
    }
  }
  if (cur.length) cues.push(cur);
  return cues.map((ws) => twoLines(ws, maxLine));
}

function twoLines(ws, maxLine) {
  const s = ws.join(' ');
  if (s.length <= maxLine) return [s];
  let best = null;
  for (let k = 1; k < ws.length; k++) {
    const a = ws.slice(0, k).join(' ');
    const b = ws.slice(k).join(' ');
    if (a.length > maxLine || b.length > maxLine) continue;
    const score = Math.abs(a.length - b.length) - (/[,.;:?]$/.test(ws[k - 1]) ? 8 : 0);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best ? best.lines : [s];
}

/** Cues for every VO line: start at the window start, run for the spoken length (measured or estimated). */
export function buildCues(T, voDurations = {}) {
  const cues = [];
  for (const v of T.vo) {
    const spoken = voDurations[v.id] ?? v.estSeconds;
    const span = Math.min(v.window, spoken + 0.3);
    const parts = cueTexts(v.text);
    const chars = parts.map((p) => p.join(' ').length);
    const total = chars.reduce((a, b) => a + b, 0);
    let t = v.start;
    parts.forEach((p, i) => {
      const d = Math.max(1.2, (span * chars[i]) / total);
      const end = i === parts.length - 1 ? Math.max(t + 1.2, v.start + span) : t + d;
      cues.push({ kind: 'vo', id: `${v.id}.${i + 1}`, start: +t.toFixed(3), end: +Math.min(end, v.end + 0.4).toFixed(3), lines: p });
      t = end;
    });
  }
  for (const q of T.quotes) cues.push({ kind: 'quote', id: q.id, start: q.start, end: q.end, lines: cueTexts(q.text, 40)[0], who: q.who });
  return cues.sort((a, b) => a.start - b.start);
}

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.kind === 'quote' ? `[${c.who}] ` : ''}${c.lines.join('\n')}\n`).join('\n');
}

export const describeShots = (T) => T.shots.map((s) => `${tc(s.start)}–${tc(s.end)}  ${s.id.padEnd(5)} ${s.script}`).join('\n');
