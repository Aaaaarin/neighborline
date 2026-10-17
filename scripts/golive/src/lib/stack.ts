/**
 * A private local stack for the live intakes, on golive's own ports so it never collides with `pnpm dev` (3000/4010/
 * 4020/4030), e2e (3100) or the video (3500/45xx): web 3340 (next dev, NEXT_DIST_DIR=.next-golive), fake PayPal 4341,
 * approver 4342, dev-db 4343 (+4344 control). AI_MODE=live with the real keys; PayPal stays fake (intake never pays).
 * Every process is its own group; stop() signals only those groups.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Env } from './env.js';
import { pidFileFor, startService, waitForUrl, type Service } from './proc.js';

export const STACK_PORTS = { web: 3340, fake: 4341, approver: 4342, db: 4343 } as const;

export interface Stack {
  url: string;
  stop(): void;
}

export async function startLiveStack(repo: string, out: string, env: Env, opts: { ports?: Partial<typeof STACK_PORTS>; log: (s: string) => void }): Promise<Stack> {
  const ports = { ...STACK_PORTS, ...opts.ports };
  const pidFile = pidFileFor(out);
  const secret = randomBytes(32).toString('hex');
  const DATABASE_URL = `postgres://postgres@127.0.0.1:${ports.db}/postgres`;
  const base: Env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NEXT_TELEMETRY_DISABLED: '1' };
  const services: Service[] = [];
  const logs = join(out, 'live-ai', 'stack');
  const start = (name: string, args: string[], cwd: string, e: Env) => services.push(startService(name, 'pnpm', args, { cwd, env: e, logFile: join(logs, `${name}.log`), pidFile }));
  const stop = () => services.forEach((s) => s.stop());
  try {
    start('dev-db', ['--filter', '@neighborline/dev-db', 'start'], repo, { ...base, DEV_DB_PORT: String(ports.db), DEV_DB_CONTROL_PORT: String(ports.db + 1) });
    start('fake-paypal', ['--filter', '@neighborline/fake-paypal', 'start'], repo, { ...base, FAKE_PAYPAL_PORT: String(ports.fake), WEBHOOK_TARGET_URL: `http://127.0.0.1:${ports.web}/api/webhooks/paypal` });
    if (!(await waitForUrl(`http://127.0.0.1:${ports.db + 1}/health`, { timeoutMs: 60_000 }))) throw new Error(`dev-db did not start (see ${logs}/dev-db.log)`);
    start('approver', ['--filter', '@neighborline/approver', 'start'], repo, { ...base, APPROVER_PORT: String(ports.approver), NEIGHBORLINE_APPROVER_SECRET: secret, DATABASE_URL, PAYPAL_MODE: 'fake', FAKE_PAYPAL_URL: `http://127.0.0.1:${ports.fake}`, DEMO_MODE: 'true' });
    const llm = env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
    start('web', ['exec', 'next', 'dev', '-p', String(ports.web)], join(repo, 'apps/web'), {
      ...base,
      PAYPAL_MODE: 'fake',
      FAKE_PAYPAL_URL: `http://127.0.0.1:${ports.fake}`,
      AI_MODE: 'live',
      LLM_PROVIDER: llm,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ...(env.OPENAI_MODEL ? { OPENAI_MODEL: env.OPENAI_MODEL } : {}),
      ...(env.ANTHROPIC_MODEL ? { ANTHROPIC_MODEL: env.ANTHROPIC_MODEL } : {}),
      DEMO_MODE: 'true',
      RATE_LIMITS: 'off',
      DATABASE_URL,
      DEV_DB_CONTROL_URL: `http://127.0.0.1:${ports.db + 1}`,
      APPROVER_URL: `http://127.0.0.1:${ports.approver}`,
      NEIGHBORLINE_APPROVER_SECRET: secret,
      APP_BASE_URL: `http://localhost:${ports.web}`,
      NEXT_DIST_DIR: '.next-golive',
    });
    for (const [name, url] of [['fake-paypal', `http://127.0.0.1:${ports.fake}/__fake/health`], ['approver', `http://127.0.0.1:${ports.approver}/v1/health`], ['web', `http://127.0.0.1:${ports.web}/api/health`]] as const) {
      if (!(await waitForUrl(url, { timeoutMs: 240_000 }))) throw new Error(`${name} did not start (see ${logs}/${name}.log)`);
    }
    opts.log(`  stack up: web :${ports.web} (live AI, ${llm}) · fake PayPal :${ports.fake} · approver :${ports.approver} · dev-db :${ports.db}`);
    return { url: `http://127.0.0.1:${ports.web}`, stop };
  } catch (err) {
    stop();
    throw err;
  }
}
