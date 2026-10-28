/**
 * `pnpm --filter @neighborline/approver start`
 *
 * With APPROVER_CONFIG_STDIN=1 the process reads a JSON object of secrets from stdin before it
 * starts (scripts/render-start.sh uses this), so the Payouts credentials never appear in this
 * process's environment (/proc/<pid>/environ) — only in its memory.
 */
import { createDb } from '@neighborline/db';
import { PayPalClient, PayoutsApi, WebhooksApi } from '@neighborline/paypal';
import { ConfigError, readConfig, type Env } from './config.js';
import { jsonLogger } from './log.js';
import { healthFrom, startApproverServer } from './server.js';

async function stdinSecrets(): Promise<Env> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out: Env = {};
  for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' && v !== '') out[k] = v;
  return out;
}

const env: Env = { ...process.env, ...(process.env.APPROVER_CONFIG_STDIN === '1' ? await stdinSecrets() : {}) };

let cfg;
try {
  cfg = readConfig(env);
} catch (err) {
  if (err instanceof ConfigError) {
    jsonLogger('error', 'config.invalid', { error: err.message });
    process.exit(1);
  }
  throw err;
}
for (const w of cfg.warnings) jsonLogger('warn', 'config.warning', { warning: w });
if (!cfg.databaseUrl) {
  jsonLogger('error', 'config.invalid', { error: 'DATABASE_URL is required: Postgres in production, or the local dev database (pnpm dev starts tools/dev-db and sets it)' });
  process.exit(1);
}

const handle = createDb({ url: cfg.databaseUrl });
const client = new PayPalClient({ clientId: cfg.paypal.clientId, clientSecret: cfg.paypal.clientSecret, baseUrl: cfg.paypal.baseUrl });
const running = await startApproverServer({
  db: () => handle.db,
  payouts: new PayoutsApi(client),
  webhooks: new WebhooksApi(client),
  config: { requirePasskeys: cfg.requirePasskeys, demoMode: cfg.demoMode, webhookId: cfg.paypal.webhookId, paypalMode: cfg.paypal.mode, standInReceiver: cfg.standInReceiver },
  env,
  log: jsonLogger,
  secret: cfg.secret,
  health: healthFrom(cfg),
  port: cfg.port,
  host: cfg.host,
});
jsonLogger('info', 'listening', {
  url: running.url,
  paypalMode: cfg.paypal.mode,
  paypalBaseUrl: cfg.paypal.baseUrl,
  credentials: cfg.paypal.credentials,
  requirePasskeys: cfg.requirePasskeys,
  demoMode: cfg.demoMode,
});

const shutdown = () => {
  void running
    .close()
    .then(() => handle.close())
    .finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
