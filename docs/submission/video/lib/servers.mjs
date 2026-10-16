// Starts the four-process stack (dev-db, fake PayPal, approver, web production build) on the video's own ports,
// like apps/web/playwright.config.ts does for e2e. Every child runs in its own process group; stop() kills only
// those groups (never a broad pkill), and the PIDs are written to OUT/logs/servers.pids for manual cleanup.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS, PORTS, REPO, WEB, log, sleep } from './common.mjs';

const DIST = process.env.VIDEO_NEXT_DIST_DIR ?? '.next-video';
const PIDFILE = join(DIRS.logs, 'servers.pids');

async function waitFor(url, label, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`${label} did not come up at ${url}`);
    await sleep(300);
  }
}

/** `next build` rewrites two tracked files to point at our dist dir; put them back byte-for-byte. */
function buildWeb(env) {
  const tracked = ['next-env.d.ts', 'tsconfig.json'].map((f) => join(WEB, f));
  const before = tracked.map((f) => readFileSync(f));
  log(`next build → apps/web/${DIST} (a few minutes)`);
  const r = spawnSync('pnpm', ['exec', 'next', 'build'], { cwd: WEB, env, stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(join(DIRS.logs, 'next-build.log'), Buffer.concat([r.stdout ?? Buffer.alloc(0), r.stderr ?? Buffer.alloc(0)]));
  tracked.forEach((f, i) => writeFileSync(f, before[i]));
  if (r.status !== 0) throw new Error(`next build failed; see ${join(DIRS.logs, 'next-build.log')}`);
}

export async function startServers({ rebuild = false } = {}) {
  const secret = randomBytes(32).toString('hex');
  const DATABASE_URL = `postgres://postgres@127.0.0.1:${PORTS.db}/postgres`;
  const baseEnv = { ...process.env };
  delete baseEnv.NODE_ENV;
  const webEnv = {
    ...baseEnv,
    PAYPAL_MODE: 'fake',
    FAKE_PAYPAL_URL: `http://127.0.0.1:${PORTS.fake}`,
    AI_MODE: 'fixture',
    DEMO_MODE: 'true',
    DATABASE_URL,
    DEV_DB_CONTROL_URL: `http://127.0.0.1:${PORTS.db + 1}`,
    APPROVER_URL: `http://127.0.0.1:${PORTS.approver}`,
    NEIGHBORLINE_APPROVER_SECRET: secret,
    NEXT_DIST_DIR: DIST,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  if (rebuild || !existsSync(join(WEB, DIST, 'BUILD_ID'))) buildWeb(webEnv);

  const procs = [];
  const run = (name, cmd, args, cwd, env) => {
    const out = createWriteStream(join(DIRS.logs, `${name}.log`));
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    p.stdout.pipe(out);
    p.stderr.pipe(out);
    procs.push({ name, pid: p.pid });
    writeFileSync(PIDFILE, procs.map((x) => `${x.pid} ${x.name}`).join('\n') + '\n');
    return p;
  };
  run('dev-db', 'pnpm', ['--filter', '@neighborline/dev-db', 'start'], REPO, { ...baseEnv, DEV_DB_PORT: String(PORTS.db), DEV_DB_CONTROL_PORT: String(PORTS.db + 1) });
  run('fake-paypal', 'pnpm', ['--filter', '@neighborline/fake-paypal', 'start'], REPO, {
    ...baseEnv,
    FAKE_PAYPAL_PORT: String(PORTS.fake),
    WEBHOOK_TARGET_URL: `http://localhost:${PORTS.web}/api/webhooks/paypal`,
  });
  await waitFor(`http://127.0.0.1:${PORTS.db + 1}/health`, 'dev-db');
  run('approver', 'pnpm', ['--filter', '@neighborline/approver', 'start'], REPO, {
    ...baseEnv,
    APPROVER_PORT: String(PORTS.approver),
    NEIGHBORLINE_APPROVER_SECRET: secret,
    DATABASE_URL,
    PAYPAL_MODE: 'fake',
    FAKE_PAYPAL_URL: `http://127.0.0.1:${PORTS.fake}`,
    DEMO_MODE: 'true',
  });
  run('web', 'pnpm', ['exec', 'next', 'start', '-p', String(PORTS.web)], WEB, webEnv);
  await waitFor(`http://127.0.0.1:${PORTS.fake}/__fake/health`, 'fake-paypal');
  await waitFor(`http://127.0.0.1:${PORTS.approver}/v1/health`, 'approver');
  await waitFor(`http://localhost:${PORTS.web}/`, 'web');
  log(`stack up: web :${PORTS.web} · fake-paypal :${PORTS.fake} · approver :${PORTS.approver} · dev-db :${PORTS.db} (pids in ${PIDFILE})`);

  const stop = () => {
    for (const p of procs) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    writeFileSync(PIDFILE, '');
  };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (stop(), process.exit(130)));
  return { stop, procs };
}

// `node lib/servers.mjs` keeps the stack up until Ctrl-C (useful for manual takes).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  await startServers({ rebuild: process.argv.includes('--rebuild') });
  await new Promise(() => {});
}
