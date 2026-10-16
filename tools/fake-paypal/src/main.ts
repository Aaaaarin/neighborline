/** `pnpm --filter @neighborline/fake-paypal start` — env: FAKE_PAYPAL_PORT, WEBHOOK_TARGET_URL, FAKE_PAYPAL_* (see README). */
import { configFromEnv } from './config.js';
import { createFakePayPal } from './server.js';

const { port, ...cfg } = configFromEnv();
const fake = await createFakePayPal({ ...cfg, port, host: process.env.FAKE_PAYPAL_HOST ?? '127.0.0.1' });
console.log(`[fake-paypal] listening on ${fake.url}`);
console.log(`[fake-paypal] webhook target: ${fake.config.webhookTargetUrl ?? '(none — set WEBHOOK_TARGET_URL)'}; webhook_id: ${fake.config.webhookId}`);
console.log(`[fake-paypal] payout processing delay: ${fake.config.processingDelayMs}ms; state: ${fake.url}/__fake/state`);

const shutdown = () => {
  void fake.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
