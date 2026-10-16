// Records the /demo stage takes with the Chrome DevTools screencast (true device pixels, JPEG q92), then
// rebuilds a constant-30-fps master per take. Stage events are timestamped from the app's own SSE stream
// (/api/stream) on the same wall clock as the screencast frames, so every marker is in take seconds without
// a sync flash.
//
//   takes/<id>.mp4            30 fps master, t=0 is the first captured frame
//   takes/<id>.markers.json   { dpr, playAt, doneAt, clock, events: [{type,status,t}], rects: {...} }
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, CHROME_ARGS, DIRS, HIDE_CSS, ffmpeg, log, playwright, sleep } from './common.mjs';

export const TAKES = {
  // tail = how long we keep recording after the stopwatch stops (the edit holds on these frames).
  lan: { url: '/demo?scenario=lan&speed=1', speed: 1, done: /Stopped at the verified SUCCESS webhook/, idle: 3000, tail: 26_000 },
  rosa: { url: '/demo?scenario=rosa&speed=2', speed: 2, done: /Stopped at the verified SUCCESS webhook/, idle: 1500, tail: 14_000 },
  blocked: { url: '/demo?scenario=blocked&speed=1', speed: 1, done: /blocked before any money moved/, idle: 1500, tail: 9_000 },
};

/** Subscribe to the app's SSE stream from Node and timestamp every stage event with Date.now(). */
function listenStream(events) {
  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/stream`, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          const m = JSON.parse(data.slice(6));
          if (m.kind !== 'stage') continue;
          const e = m.event;
          events.push({ wall: Date.now(), type: e.type, status: e.status ?? e.organizerId ?? e.severity ?? undefined, kind: e.kind ?? e.template ?? undefined });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return () => ac.abort();
}

async function rectsOf(page) {
  return page.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const org = document.querySelector('#panel-organizers > div');
    const rail = document.querySelector('#panel-rail');
    const timer = [...document.querySelectorAll('[role="timer"]')].at(-1);
    // The stopwatch block: from the "Voice note to cash" heading down to the people/system split.
    const clockBlock = rail?.querySelector(':scope > div > div:first-child');
    return {
      requester: r(document.querySelector('#panel-requester')),
      dana: r(org?.children[0]),
      marcus: r(org?.children[1]),
      organizers: r(document.querySelector('#panel-organizers')),
      rail: r(rail),
      clock: r(clockBlock),
      timer: r(timer),
    };
  });
}

const cssRects = (r, dpr) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && Object.fromEntries(Object.entries(v).map(([a, n]) => [a, Math.round(n / dpr)]))]));

export async function recordTake(id, { dpr = 1 } = {}) {
  const t = TAKES[id];
  const { chromium } = await playwright();
  const frameDir = join(DIRS.takes, `${id}-frames`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  // No demo reset (POST /api/demo/reset is not public): a new browser context is a new visitor whose runs
  // are its own, and demo runs never count against the group's caps.
  const browser = await chromium.launch({ args: CHROME_ARGS });
  // The DevTools screencast delivers CSS-pixel frames whatever the deviceScaleFactor, so for sharp 2× frames we
  // render a (1920·dpr)×(1080·dpr) viewport at DPR 1 with `html{zoom:dpr}`: the same 1920×1080 layout, twice
  // the pixels. The rail's 100dvh max-height is pinned to its 1080p value so it scrolls exactly as at 1080p.
  const ctx = await browser.newContext({ viewport: { width: 1920 * dpr, height: 1080 * dpr }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(BASE + t.url, { waitUntil: 'load' });
  await page.addStyleTag({ content: HIDE_CSS + (dpr !== 1 ? `html{zoom:${dpr}} #panel-rail > div{max-height:${1080 - 112}px!important}` : '') });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    const n = frames.length;
    const file = join(frameDir, `${String(n).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, ts: f.metadata.timestamp });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    } catch {
      /* closing */
    }
  });
  const events = [];
  const stopStream = listenStream(events);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: Number(process.env.VIDEO_JPEG_QUALITY ?? 88), maxWidth: 1920 * dpr, maxHeight: 1080 * dpr, everyNthFrame: 1 });
  // Nudge one repaint so the first frame arrives immediately.
  await page.evaluate(() => (document.body.style.outline = '0 solid transparent'));
  await sleep(t.idle);
  const rects = await rectsOf(page);
  const playWall = Date.now();
  await page.getByRole('button', { name: /play scenario/i }).click();
  await page.getByText(t.done).first().waitFor({ timeout: 120_000 });
  const doneWall = Date.now();
  const clock = await page.getByRole('timer').last().innerText();
  const split = await page.evaluate(() => [...document.querySelectorAll('dl dd')].map((d) => d.textContent));
  await sleep(t.tail);
  const endWall = Date.now();
  await cdp.send('Page.stopScreencast');
  await sleep(300);
  stopStream();
  const rectsEnd = await rectsOf(page);
  await browser.close();

  if (!frames.length) throw new Error(`no screencast frames for ${id}`);
  const t0 = frames[0].ts; // seconds since epoch
  const at = (wall) => +(wall / 1000 - t0).toFixed(3);
  // Concat-demuxer list with each frame's real duration → constant 30 fps.
  const lines = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts : endWall / 1000;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  const list = join(frameDir, 'list.txt');
  writeFileSync(list, lines.join('\n') + '\n');
  const out = join(DIRS.takes, `${id}.mp4`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=30,scale=${1920 * dpr}:${1080 * dpr}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', out]);
  const markers = {
    id,
    url: t.url,
    speed: t.speed,
    dpr,
    frames: frames.length,
    duration: at(endWall),
    playAt: at(playWall),
    doneAt: at(doneWall),
    clock,
    split,
    events: events.map((e) => ({ t: at(e.wall), type: e.type, ...(e.status ? { status: e.status } : {}), ...(e.kind ? { kind: e.kind } : {}) })),
    // CSS px of the 1920×1080 layout (getBoundingClientRect reports zoomed px).
    rects: cssRects(rects, dpr),
    rectsEnd: cssRects(rectsEnd, dpr),
  };
  writeFileSync(join(DIRS.takes, `${id}.markers.json`), JSON.stringify(markers, null, 2));
  rmSync(frameDir, { recursive: true, force: true });
  log(`take ${id}: ${frames.length} frames, ${markers.duration.toFixed(1)} s, play at ${markers.playAt}s, clock ${clock}`);
  return markers;
}

/** Full-page stills of /trust and /report plus the anchors the pans need (CSS px). */
export async function recordStills({ dpr = 1 } = {}) {
  const { chromium } = await playwright();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr, colorScheme: 'light', locale: 'en-US' });
  const page = await ctx.newPage();
  const anchors = {};
  for (const [name, path, heads] of [
    ['trust', '/trust', ['Know your agent']],
    ['report', '/report', ['Where the money went', 'Are approvals fair across languages']],
    // Not in the script's shot list yet; captured so the next draft can cut it in (see README).
    ['rules', '/organizer/rules', []],
  ]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: HIDE_CSS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    anchors[name] = { pageHeight: await page.evaluate(() => document.documentElement.scrollHeight) };
    for (const h of heads) {
      const box = await page.locator('h1, h2, h3', { hasText: h }).first().boundingBox();
      anchors[name][h] = box ? Math.round(box.y) : null;
    }
    await page.screenshot({ path: join(DIRS.stills, `${name}-full.png`), fullPage: true });
  }
  await browser.close();
  writeFileSync(join(DIRS.stills, 'anchors.json'), JSON.stringify({ dpr, ...anchors }, null, 2));
  log('stills: trust, report', JSON.stringify(anchors));
  return anchors;
}

if (process.argv[1]?.endsWith('record.mjs')) {
  const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? 'lan,rosa,blocked').split(',');
  const dpr = Number(process.argv.find((a) => a.startsWith('--dpr='))?.slice(6) ?? 1);
  for (const id of only) if (id === 'stills') await recordStills({ dpr }); else await recordTake(id, { dpr });
}
