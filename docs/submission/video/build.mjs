#!/usr/bin/env node
// Neighborline demo video: one command from the running product to an MP4.
//
//   node docs/submission/video/build.mjs [--record] [--with-vo] [--rebuild-web] [--fresh-tests] [--no-thumbnail]
//
// Draft 3 (default): real screen captures + burned-in captions of the VO lines + title cards, no audio.
// See README.md in this folder for the pipeline, outputs and where the voiceover drops in.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DIRS, HERE, OUT, REPO, exists, ffmpeg, log, probeDuration, secs, tc } from './lib/common.mjs';
import { toAss } from './lib/captions.mjs';
import { renderCodeCards, renderCorner, renderEnd, renderHandles, renderLowerThird, renderPill, renderTitle, withRenderer } from './lib/cards.mjs';
import { qa } from './lib/qa.mjs';
import { recordStills, recordTake } from './lib/record.mjs';
import { LAYOUT, cardSegment, clipSegment, endSegment, panSegment, stageEndSegment, takeSegment } from './lib/segments.mjs';
import { voiceNoteSegment } from './lib/voicenote.mjs';
import { startServers } from './lib/servers.mjs';
import { renderThumbnails } from './lib/thumbnail.mjs';
import { buildCues, describeShots, loadTimeline, toSrt } from './lib/timeline.mjs';

const flag = (f) => process.argv.includes(f);
const WITH_VO = flag('--with-vo');
// 1.5× is the sweet spot: sharp crops, and the 2880×1620 screencast still runs ~15 fps (2× drops to ~8 fps).
const TAKE_DPR = Number(process.env.VIDEO_DPR ?? 1.5);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';

// 1. Takes and stills (needs the four-process stack on the video's own ports).
const takeFiles = ['lan', 'rosa', 'blocked'].flatMap((id) => [join(DIRS.takes, `${id}.mp4`), join(DIRS.takes, `${id}.markers.json`)]);
const stillFiles = ['trust-full.png', 'report-full.png', 'anchors.json'].map((f) => join(DIRS.stills, f));
const needTakes = flag('--record') || takeFiles.some((f) => !exists(f));
// The MCP agent take is recorded by its own lane's script (examples/mcp-agent-demo `pnpm … record`).
for (const f of ['mcp-demo.mp4', 'mcp-demo.markers.json']) if (!exists(join(DIRS.takes, f))) throw new Error(`missing takes/${f}: run pnpm --filter @neighborline/example-mcp-agent-demo record`);
const needStills = flag('--record') || stillFiles.some((f) => !exists(f));
if (needTakes || needStills) {
  const stack = await startServers({ rebuild: flag('--rebuild-web') });
  try {
    for (const id of ['lan', 'rosa', 'blocked']) if (flag('--record') || !exists(join(DIRS.takes, `${id}.mp4`))) await recordTake(id, { dpr: TAKE_DPR });
    if (needStills) await recordStills({ dpr: 2 });
  } finally {
    stack.stop();
  }
}

// 2. Fonts for libass (Be Vietnam Pro, merged Fontsource subsets incl. Vietnamese).
if (!exists(join(DIRS.fonts, 'BeVietnamPro-SemiBold.ttf'))) {
  const r = spawnSync('python3', [join(HERE, 'lib', 'fonts.py'), join(REPO, 'apps/web/node_modules/@fontsource/be-vietnam-pro/files'), DIRS.fonts], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('font merge failed');
}

// 3. The real test run for code card 4 (cached; --fresh-tests re-runs it).
const testLog = join(DIRS.cache, 'pnpm-test.log');
if (flag('--fresh-tests') || !exists(testLog)) {
  log('pnpm test (for code card 4)');
  const r = spawnSync('pnpm', ['test'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  writeFileSync(testLog, `${r.stdout}\n${r.stderr}\nEXIT ${r.status}\n`);
}

// 4. Resolve the timeline against the takes.
const { testSummary } = await import('./lib/cards.mjs');
const testTotal = (() => {
  const { rows } = testSummary(testLog);
  return rows.reduce((a, r) => a + Number(/^(\d+)/.exec(r.tests ?? '0')[1]), 0);
})();
const T = loadTimeline({ tests: testTotal });
log(`mode ${T.mode} · {T}=${T.vars.T} ("${T.vars.T_words}") · blocked ${T.vars.BLOCK_T}`);
for (const w of T.warnings) log(`VO fit: ${w}`);
let vo = null;
if (WITH_VO) vo = await (await import('./lib/vo.mjs')).generateVo(T);

// 5. Cards and overlays.
const ltFiles = [];
let tests;
await withRenderer(async (render, page) => {
  await renderTitle(render);
  await renderEnd(render, { ...T.endCard, hostedUrl: process.env.HOSTED_URL ? T.endCard.hostedUrl : null });
  await renderCorner(render, T.corner.text);
  for (const p of T.pills) await renderPill(render, p.id, p.text);
  for (const l of T.lowerThirds) {
    if (l.place === 'card') continue;
    const box = l.place === 'bottom' && l.comp === 'card' ? LAYOUT.card.lt : LAYOUT[l.comp]?.lt ?? LAYOUT.card.lt;
    await renderLowerThird(render, l.id, l, box);
    ltFiles.push({ ...l, file: join(DIRS.cards, `${l.id}.png`) });
  }
  await renderHandles(render, LAYOUT.C.handles);
  tests = await renderCodeCards(render, testLog);
  if (!flag('--no-thumbnail')) await renderThumbnails(render, T.takes.lan, page);
});
log(`cards rendered · tests on card 4: ${tests.total}${tests.failed ? ' (FAILURES!)' : ''}`);

// 6. Stills: the finished stage (last frame of the Lan take) and the pans pre-scaled to frame width.
const fr = LAYOUT.framed.frame;
const stageEnd = join(DIRS.stills, 'stage-end.png');
ffmpeg(['-sseof', '-0.5', '-i', join(DIRS.takes, 'lan.mp4'), '-frames:v', '1', '-update', '1', stageEnd]);
const anchors = (await import('node:fs')).readFileSync(join(DIRS.stills, 'anchors.json'), 'utf8');
const A = JSON.parse(anchors);
for (const n of ['trust', 'report']) ffmpeg(['-i', join(DIRS.stills, `${n}-full.png`), '-vf', `scale=${fr.w}:-2:flags=lanczos`, join(DIRS.stills, `${n}-${fr.w}.png`)]);
const k = fr.w / 1920; // CSS px → frame px

// 7. One segment per shot.
const segs = [];
for (const s of T.shots) {
  const file = join(DIRS.segs, `${s.id}.mp4`);
  log(`segment ${s.id} ${tc(s.start)}–${tc(s.end)} ${s.kind}${s.comp ? ` ${s.comp}` : ''}`);
  if (s.kind === 'voicenote') {
    const lan = vo?.files.find((f) => f.id === 'lan_voice');
    await voiceNoteSegment(s, file, lan ? { voiceFile: lan.file, voiceSeconds: vo.durations.lan_voice } : {});
  } else if (s.kind === 'take') takeSegment(s, T.takes[s.take], file);
  else if (s.kind === 'clip') clipSegment(s, T.takes[s.take], file);
  else if (s.kind === 'card' || s.kind === 'code') cardSegment(s, join(DIRS.cards, `${s.card}.png`), file);
  else if (s.kind === 'pan') {
    const a = A[s.still];
    const maxY = Math.floor(a.pageHeight * k - fr.h);
    const clamp = (y) => Math.max(0, Math.min(maxY, Math.round(y)));
    const y0 = clamp((a[s.anchor] - (s.still === 'report' ? 110 : 60)) * k);
    const y1 = clamp(s.panTo ? (a[s.panTo] - 150) * k : y0 + s.panCss * k);
    panSegment(s, join(DIRS.stills, `${s.still}-${fr.w}.png`), y0, y1, file, s.hold ?? 0);
  } else if (s.kind === 'stageEnd') stageEndSegment(s, stageEnd, T.takes.lan.dpr, file);
  else if (s.kind === 'end') endSegment(s, T.takes.lan, stageEnd, join(DIRS.cards, 'end.png'), join(DIRS.cards, 'end-lit.png'), secs(s.litAt ?? s.end) - s.start, file);
  const d = probeDuration(file);
  if (Math.abs(d - s.dur) > 0.07) throw new Error(`${s.id}: ${d.toFixed(3)} s, expected ${s.dur}`);
  segs.push(file);
}
const list = join(DIRS.segs, 'list.txt');
writeFileSync(list, segs.map((f) => `file '${f}'`).join('\n') + '\n');
const raw = join(OUT, 'video_raw.mp4');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', raw]);

// 8. Captions: SRT (YouTube CC, committed) + ASS (burn-in, per-composition placement).
const cues = buildCues(T, vo?.durations);
const srt = toSrt(cues);
writeFileSync(join(HERE, 'captions.srt'), srt);
writeFileSync(join(OUT, 'captions.srt'), srt);
const assFile = join(OUT, 'captions.ass');
writeFileSync(assFile, toAss(T, cues));

// 9. Overlays (corner tag, lower thirds, pills, handles) + burned captions + a silent track, in one pass.
const total = T.shots.at(-1).end;
const ov = [
  // The corner tag, minus any `except` windows.
  ...T.corner.except
    .reduce((wins, [a, b]) => wins.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, a], [b, e]].filter(([x, y]) => y - x > 0.2))), [[T.corner.start, T.corner.end]])
    .map(([start, end]) => ({ file: join(DIRS.cards, 'corner.png'), start, end })),
  ...ltFiles,
  ...T.pills.map((p) => ({ ...p, file: join(DIRS.cards, `${p.id}.png`) })),
  ...T.overlays.map((o) => ({ ...o, file: join(DIRS.cards, `${o.card}.png`) })),
];
const inputs = ['-i', raw];
const fc = [];
let prev = '0:v';
ov.forEach((o, i) => {
  // Each PNG is only decoded for its own window (shifted into place with setpts), so the pass stays fast.
  const d = +(o.end - o.start).toFixed(3);
  inputs.push('-loop', '1', '-framerate', '30', '-t', String(d), '-i', o.file);
  const fades = `fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${Math.max(0, d - 0.18).toFixed(3)}:d=0.18:alpha=1`;
  fc.push(`[${i + 1}:v]format=rgba,${fades},setpts=PTS+${o.start.toFixed(3)}/TB[o${i}]`);
  fc.push(`[${prev}][o${i}]overlay=0:0:eof_action=pass:repeatlast=0[m${i}]`);
  prev = `m${i}`;
});
const escPath = (p) => p.replace(/:/g, '\\:').replace(/'/g, "\\'");
fc.push(`[${prev}]ass=filename='${escPath(assFile)}':fontsdir='${escPath(DIRS.fonts)}',format=yuv420p[v]`);
inputs.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo');
const draft = join(OUT, WITH_VO ? T.tl.output.file.replace(/\.mp4$/, '-vo-silent.mp4') : T.tl.output.file);
ffmpeg([...inputs, '-filter_complex', fc.join(';'), '-map', '[v]', '-map', `${ov.length + 1}:a`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', draft]);
let final = draft;
if (WITH_VO) {
  final = join(OUT, T.tl.output.file.replace(/\.mp4$/, '-vo.mp4'));
  (await import('./lib/vo.mjs')).mixVo(draft, vo.files, final);
}
const dur = probeDuration(final);
if (dur > T.tl.output.maxSeconds) throw new Error(`video is ${dur.toFixed(1)} s, over the ${T.tl.output.maxSeconds} s budget`);

// 10. EDL with the resolved, actual timecodes (committed next to timeline.json) and QA frames.
const edl = {
  output: final,
  durationSeconds: +dur.toFixed(2),
  stopwatch: { lan: T.takes.lan.clock, lanSplit: T.takes.lan.split.slice(0, 2), rosa: T.takes.rosa.clock, blocked: T.takes.blocked.clock },
  approval2: { signedWith: T.takes.lan.signedWith ?? null, tapAfterPlay: T.takes.lan.tapAt != null ? +(T.takes.lan.tapAt - T.takes.lan.playAt).toFixed(3) : null },
  takes: Object.fromEntries(Object.entries(T.takes).map(([id, t]) => [id, { url: t.url ?? 'examples/mcp-agent-demo (scripted, typewriter)', dpr: t.dpr, playAt: t.playAt, eventsAfterPlay: t.ev }])),
  shots: T.shots.map((s) => ({ id: s.id, start: tc(s.start), end: tc(s.end), seconds: s.dur, script: s.script, kind: s.kind, ...(s.comp ? { comp: s.comp } : {}), ...(s.take ? { take: s.take, src: s.src } : {}), ...(s.speed ? { speed: s.speed } : {}) })),
  vo: T.vo.map((v) => ({ ...v, start: tc(v.start), end: tc(v.end), ...(vo ? { measuredSeconds: +vo.durations[v.id].toFixed(2) } : {}) })),
  voTotalWords: T.vo.reduce((a, v) => a + v.words, 0),
  lowerThirds: T.lowerThirds.map((l) => ({ id: l.id, start: tc(l.start), end: tc(l.end), title: l.title, sub: l.sub })),
  warnings: T.warnings,
  tests: { total: tests.total, failed: tests.failed, rows: tests.rows },
};
writeFileSync(join(HERE, 'edl.json'), JSON.stringify(edl, null, 2) + '\n');
copyFileSync(join(DIRS.cards, 'title.png'), join(DIRS.frames, 'card-title.png'));
qa(final, T);
log(`done: ${final} (${dur.toFixed(2)} s)`);
console.log(describeShots(T));
if (!existsSync(final)) process.exit(1);
