#!/usr/bin/env node
// `pnpm dev`: fake PayPal (:4010) + Next dev server (:3000) together, zero credentials.
// Reads the root .env (if any) and passes it to both. With PAYPAL_MODE=sandbox the fake is not started.
import { spawn } from 'node:child_process';
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
env.FAKE_PAYPAL_URL ||= `http://127.0.0.1:${fakePort}`; // the fake binds 127.0.0.1
env.WEBHOOK_TARGET_URL ||= `http://localhost:${webPort}/api/webhooks/paypal`;

const procs = [];
const colors = { paypal: '\x1b[36m', web: '\x1b[35m' };
function run(name, args) {
  // detached: own process group, so shutdown can stop pnpm and the servers it started.
  const p = spawn('pnpm', args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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

console.log(`neighborline dev · PAYPAL_MODE=${env.PAYPAL_MODE} · AI_MODE=${env.AI_MODE} · ENGINE=${env.ENGINE || 'real'}`);
if (env.PAYPAL_MODE === 'fake') run('paypal', ['--filter', '@neighborline/fake-paypal', 'start']);
run('web', ['--filter', '@neighborline/web', 'exec', 'next', 'dev', '-p', webPort]);
