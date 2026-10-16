// Shared paths, helpers and the Playwright import for the video pipeline.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = dirname(dirname(fileURLToPath(import.meta.url))); // docs/submission/video
export const REPO = join(HERE, '..', '..', '..');
export const WEB = join(REPO, 'apps', 'web');
export const OUT = process.env.VIDEO_OUT ?? '/home/claude/video-out';
export const DIRS = {
  takes: join(OUT, 'takes'),
  stills: join(OUT, 'stills'),
  cards: join(OUT, 'cards'),
  segs: join(OUT, 'segs'),
  fonts: join(OUT, 'fonts'),
  vo: join(OUT, 'vo'),
  frames: join(OUT, 'frames'),
  logs: join(OUT, 'logs'),
  cache: join(OUT, 'cache'),
};
for (const d of [OUT, ...Object.values(DIRS)]) mkdirSync(d, { recursive: true });

export const PORTS = {
  web: Number(process.env.VIDEO_WEB_PORT ?? 3500),
  fake: Number(process.env.VIDEO_FAKE_PAYPAL_PORT ?? 4510),
  approver: Number(process.env.VIDEO_APPROVER_PORT ?? 4520),
  db: Number(process.env.VIDEO_DEV_DB_PORT ?? 4530),
};
export const BASE = process.env.BASE_URL ?? `http://localhost:${PORTS.web}`;

const webRequire = createRequire(join(WEB, 'package.json'));
export const resolveWeb = (p) => webRequire.resolve(p);
export async function playwright() {
  const m = await import(pathToFileURL(webRequire.resolve('@playwright/test')).href);
  return m.chromium ? m : m.default;
}

/** Chromium launch args shared by every capture: no translate bar, no scrollbars, en-US. */
export const CHROME_ARGS = ['--lang=en-US', '--disable-features=Translate', '--hide-scrollbars', '--font-render-hinting=none'];
export const HIDE_CSS = `::-webkit-scrollbar{display:none!important} html{scrollbar-width:none!important} *{caret-color:transparent!important} nextjs-portal{display:none!important}`;

export const log = (...a) => console.log(`[video ${new Date().toISOString().slice(11, 19)}]`, ...a);

export function ffmpeg(args, { quiet = true } = {}) {
  const full = ['-hide_banner', '-y', ...(quiet ? ['-loglevel', 'error'] : []), ...args];
  const r = spawnSync('ffmpeg', full, { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ffmpeg ${full.join(' ')}`);
}

export function probeDuration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const exists = existsSync;

/** "1:27.5" | 87.5 → seconds */
export function secs(v) {
  if (typeof v === 'number') return v;
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(v).trim());
  if (!m) throw new Error(`bad timecode ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
export function tc(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
