/** Shared by golive's tests: temp dirs, free ports, a fake PayPal wired like a sandbox, and env for it. */
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Runner } from './lib/proc.js';

export const tmp = (prefix = 'golive-') => mkdtempSync(join(tmpdir(), prefix));

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Keys that pass preflight's format checks; the fake accepts any credentials. */
export function fakePaypalEnv(baseUrl: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PAYPAL_BASE_URL: baseUrl,
    PAYPAL_CLIENT_ID: `AMain${'x'.repeat(60)}`,
    PAYPAL_CLIENT_SECRET: `EMain${'y'.repeat(60)}`,
    PAYPAL_PAYOUTS_CLIENT_ID: `APayouts${'x'.repeat(60)}`,
    PAYPAL_PAYOUTS_CLIENT_SECRET: `EPayouts${'y'.repeat(60)}`,
    SANDBOX_PERSONAL_EMAIL: 'sb-lan47@personal.example.com',
    GOLIVE_POLL_INTERVAL_MS: '40',
    GOLIVE_POLL_SECONDS: '10',
    GOLIVE_CAPTURE_WAIT_SECONDS: '5',
    ...extra,
  };
}

/** A Runner that records calls and answers from a table (first matching predicate wins). */
export function fakeRunner(answers: Array<{ match: (cmd: string, args: string[]) => boolean; code?: number; stdout?: string; stderr?: string; effect?: () => void }> = []) {
  const calls: Array<{ cmd: string; args: string[]; env?: Record<string, string | undefined>; cwd?: string }> = [];
  const run: Runner = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, ...(opts.env ? { env: opts.env } : {}), ...(opts.cwd ? { cwd: opts.cwd } : {}) });
    const a = answers.find((x) => x.match(cmd, args));
    a?.effect?.();
    return { code: a ? (a.code ?? 0) : 0, stdout: a?.stdout ?? '', stderr: a?.stderr ?? '', timedOut: false, ms: 1 };
  };
  return { run, calls };
}
