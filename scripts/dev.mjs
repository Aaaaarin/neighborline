#!/usr/bin/env node
// `pnpm dev`: zero credentials. Four processes, like production:
//   dev-db    :4030  embedded Postgres (PGlite) on loopback, shared by web + approver (skipped if DATABASE_URL is set)
//   paypal    :4010  tools/fake-paypal (skipped with PAYPAL_MODE=sandbox)
//   approver  :4020  apps/approver — the ONLY process given Payouts credentials
//   web       :3000  Next dev server — gets no PAYPAL_PAYOUTS_* variables
// Reads the root .env (if any). A random NEIGHBORLINE_APPROVER_SECRET is generated per run unless set.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].replace(/(^|\s+)#.*$/, '');
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (v !== '') out[m[1]] = v; // empty means "use the default"
  }
  return out;
}

const fileEnv = loadEnv(join(root, '.env'));
const env = { ...fileEnv, ...process.env };
env.PAYPAL_MODE ||= 'fake';
env.AI_MODE ||= 'fixture';
const webPort = env.PORT || '3000';
const fakePort = env.FAKE_PAYPAL_PORT || '4010';
const approverPort = env.APPROVER_PORT || '4020';
const dbPort = env.DEV_DB_PORT || '4030';
env.FAKE_PAYPAL_URL ||= `http://127.0.0.1:${fakePort}`; // the fake binds 127.0.0.1
env.WEBHOOK_TARGET_URL ||= `http://localhost:${webPort}/api/webhooks/paypal`;
env.APPROVER_URL ||= `http://127.0.0.1:${approverPort}`;
env.NEIGHBORLINE_APPROVER_SECRET ||= randomBytes(32).toString('hex');
const useDevDb = !env.DATABASE_URL;
if (useDevDb) {
  env.DATABASE_URL = `postgres://postgres@127.0.0.1:${dbPort}/postgres`;
  env.DEV_DB_CONTROL_URL = `http://127.0.0.1:${Number(dbPort) + 1}`;
}

/** Payouts credentials go to the approver only; the web process never sees them. */
const PAYOUTS_ONLY = ['PAYPAL_PAYOUTS_CLIENT_ID', 'PAYPAL_PAYOUTS_CLIENT_SECRET', 'PAYPAL_PAYOUTS_WEBHOOK_ID', 'APPROVER_ALLOW_SHARED_CREDENTIALS'];
const webEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !PAYOUTS_ONLY.includes(k)));
/** The approver gets what it needs and nothing else (no AI keys, no donor/webhook keys of the main app). */
const APPROVER_KEYS = [
  'PATH', 'HOME', 'NODE_ENV', 'TMPDIR', 'PAYPAL_MODE', 'PAYPAL_BASE_URL', 'FAKE_PAYPAL_URL', 'DATABASE_URL', 'DEMO_MODE',
  'NEIGHBORLINE_APPROVER_SECRET', 'WEBAUTHN_ORIGIN', 'WEBAUTHN_RP_ID', 'APP_BASE_URL', 'SANDBOX_DEMO_RECEIVER_EMAIL',
  ...PAYOUTS_ONLY,
];
const TOOLING = /^(PNPM_|COREPACK_|npm_config_|XDG_|LANG$|LC_|SHELL$|USER$)/;
const approverEnv = Object.fromEntries(Object.entries(env).filter(([k]) => APPROVER_KEYS.includes(k) || TOOLING.test(k)));
approverEnv.APPROVER_PORT = approverPort;
if (approverEnv.APPROVER_ALLOW_SHARED_CREDENTIALS === 'true') {
  approverEnv.PAYPAL_CLIENT_ID = env.PAYPAL_CLIENT_ID;
  approverEnv.PAYPAL_CLIENT_SECRET = env.PAYPAL_CLIENT_SECRET;
}

const procs = [];
const colors = { db: '\x1b[33m', paypal: '\x1b[36m', approver: '\x1b[32m', web: '\x1b[35m' };
function run(name, args, procEnv) {
  // detached: own process group, so shutdown can stop pnpm and the servers it started.
  const p = spawn('pnpm', args, { cwd: root, env: procEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const prefix = `${colors[name]}[${name}]\x1b[0m `;
  for (const s of [p.stdout, p.stderr]) {
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) (s === p.stderr ? process.stderr : process.stdout).write(prefix + l + '\n');
    });
  }
  p.on('exit', (code) => {
    console.log(`${prefix}exited (${code ?? 'signal'})`);
    shutdown(code ?? 0);
  });
  procs.push(p);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitFor(url, label, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`${label} did not start within ${timeoutMs / 1000}s (${url})`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

console.log(
  `neighborline dev · PAYPAL_MODE=${env.PAYPAL_MODE} · AI_MODE=${env.AI_MODE} · ENGINE=${env.ENGINE || 'real'} · db=${useDevDb ? `dev-db :${dbPort}` : 'DATABASE_URL'} · approver :${approverPort}`,
);
if (useDevDb) run('db', ['--filter', '@neighborline/dev-db', 'start'], { ...webEnv, DEV_DB_PORT: dbPort });
if (env.PAYPAL_MODE === 'fake') run('paypal', ['--filter', '@neighborline/fake-paypal', 'start'], webEnv);
try {
  if (useDevDb) await waitFor(`${env.DEV_DB_CONTROL_URL}/health`, 'dev-db');
} catch (err) {
  console.error(String(err));
  shutdown(1);
}
run('approver', ['--filter', '@neighborline/approver', 'start'], approverEnv);
run('web', ['--filter', '@neighborline/web', 'exec', 'next', 'dev', '-p', webPort], webEnv);
