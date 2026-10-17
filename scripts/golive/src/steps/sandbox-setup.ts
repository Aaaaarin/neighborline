/**
 * sandbox-setup: idempotent PayPal sandbox configuration.
 *   1. Webhook subscriptions for <public URL>/api/webhooks/paypal on both apps (main: donations; payouts app:
 *      PAYMENT.PAYOUTS*), when a public URL is known. Otherwise deploy-render does it once Render gives the URL.
 *   2. The catalog product and the $10/$25/$50 monthly plans (ensureDonationTiers, the same call the app makes).
 *   3. Transaction Search permission, by a one-day query on the main app.
 * Ids go to golive-out/golive.env (PAYPAL_WEBHOOK_ID, PAYPAL_PAYOUTS_WEBHOOK_ID, PAYPAL_PLAN_ID_*), which deploy-render
 * pushes to Render. Writes golive-out/sandbox-setup.json.
 */
import { writeOut, type Ctx, type Step, type StepResult } from '../lib/context.js';
import { has, hostedParts, paypalBase, paypalTarget } from '../lib/env.js';
import { credentials, ensureAppWebhooks, errorShape, paypalFor, type WebhookPair } from '../lib/paypal-admin.js';

export const DONATION_PRODUCT = { id: 'NEIGHBORLINE-DONATION', name: 'Neighborline monthly gift' } as const;

/** The public origin PayPal should call, if one is known yet. */
export function knownPublicOrigin(ctx: Pick<Ctx, 'env' | 'state'>): string | null {
  const e = ctx.env;
  if (e.GOLIVE_PUBLIC_URL) return e.GOLIVE_PUBLIC_URL.replace(/\/+$/, '');
  const hosted = hostedParts(e.HOSTED_URL)?.origin;
  if (hosted) return hosted;
  const deployed = ctx.state.get<{ url?: string }>('deploy-render').url;
  if (deployed) return deployed;
  if (e.APP_BASE_URL && !/localhost|127\.0\.0\.1/.test(e.APP_BASE_URL)) return e.APP_BASE_URL.replace(/\/+$/, '');
  return null;
}

/** Shared with deploy-render: register (or confirm) both apps' webhooks and record their ids. */
export async function registerWebhooks(ctx: Ctx, origin: string): Promise<WebhookPair> {
  const pair = await ensureAppWebhooks(ctx.env, origin, { fetch: ctx.fetch, target: paypalTarget(ctx.env) });
  for (const [app, r] of [['main', pair.main], ['payouts', pair.payouts]] as const) {
    if (!r) continue;
    ctx.log(`  webhook (${app} app) ${r.action}: ${r.id} → ${r.url} (${r.events.length} event types${r.dropped.length ? `; PayPal does not offer ${r.dropped.join(', ')}` : ''})`);
    for (const s of r.stale) ctx.log(`  ! ${app} app also has ${s.id} → ${s.url} (an older URL?). Delete it in the dashboard if unused.`);
    ctx.setGenerated(app === 'main' ? 'PAYPAL_WEBHOOK_ID' : 'PAYPAL_PAYOUTS_WEBHOOK_ID', r.id);
  }
  ctx.state.patch('sandbox-setup', { webhooks: { url: pair.url, main: pair.main?.id, payouts: pair.payouts?.id } });
  return pair;
}

export const sandboxSetup: Step = {
  name: 'sandbox-setup',
  title: 'PayPal sandbox: webhooks, catalog + plans, Transaction Search',
  async run(ctx: Ctx): Promise<StepResult> {
    const mainOk = has(ctx.env, 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET');
    const payoutsOk = has(ctx.env, 'PAYPAL_PAYOUTS_CLIENT_ID', 'PAYPAL_PAYOUTS_CLIENT_SECRET');
    if (!mainOk && !payoutsOk) return { status: 'skipped', summary: 'no PayPal sandbox keys yet', next: 'Add PAYPAL_CLIENT_ID/SECRET and PAYPAL_PAYOUTS_CLIENT_ID/SECRET to .env (docs/GOLIVE.md step 1).' };
    const origin = knownPublicOrigin(ctx);
    const target = paypalTarget(ctx.env);
    if (ctx.dryRun) {
      ctx.log(`  would ${origin ? `register webhooks for ${origin}/api/webhooks/paypal on ${[mainOk && 'main', payoutsOk && 'payouts'].filter(Boolean).join(' + ')}` : 'skip webhooks until deploy-render knows the URL'}`);
      if (mainOk) ctx.log(`  would ensure product ${DONATION_PRODUCT.id} and plans $10/$25/$50, and query Transaction Search for the last 24 h`);
      return { status: 'ok', summary: `dry run against ${paypalBase(ctx.env)}` };
    }
    const report: Record<string, unknown> = { at: ctx.now().toISOString(), base: paypalBase(ctx.env), target };
    const problems: string[] = [];
    const pending: string[] = [];

    // 1. Webhooks.
    if (origin) {
      try {
        report.webhooks = await registerWebhooks(ctx, origin);
      } catch (err) {
        report.webhooks = { error: errorShape(err) };
        problems.push(`webhooks: ${(err as Error).message}`);
      }
    } else {
      report.webhooks = { pending: 'no public URL yet' };
      pending.push('webhooks wait for the Render URL (deploy-render registers them)');
    }

    // 2. Catalog product + monthly plans (main app).
    if (mainOk) {
      try {
        const pp = paypalFor(ctx.env, 'main', ctx.fetch);
        const tiers = await pp.subscriptions.ensureDonationTiers({ product: DONATION_PRODUCT });
        for (const [cents, id] of Object.entries(tiers)) ctx.setGenerated(`PAYPAL_PLAN_ID_${Number(cents) / 100}`, id);
        ctx.log(`  plans: ${Object.entries(tiers).map(([c, id]) => `$${Number(c) / 100} ${id}`).join(', ')}`);
        report.plans = { product: DONATION_PRODUCT.id, tiers };
      } catch (err) {
        report.plans = { error: errorShape(err) };
        problems.push(`plans: ${(err as Error).message}`);
      }

      // 3. Transaction Search permission.
      try {
        const pp = paypalFor(ctx.env, 'main', ctx.fetch);
        const end = ctx.now();
        const start = new Date(end.getTime() - 24 * 3_600_000);
        const txns = await pp.reporting.searchTransactions({ startDate: start, endDate: end });
        report.transactionSearch = { ok: true, rowsLast24h: txns.length };
        ctx.log(`  Transaction Search: allowed (${txns.length} transactions in the last 24 h)`);
      } catch (err) {
        const shape = errorShape(err);
        report.transactionSearch = { ok: false, error: shape };
        const denied = shape.status === 403 || /NOT_AUTHORIZED|PERMISSION/i.test(shape.name);
        problems.push(denied ? 'Transaction Search: permission missing. developer.paypal.com → main app → Features → tick "Transaction search" → Save (can take a few minutes), then re-run.' : `Transaction Search: ${shape.name} ${shape.message}`);
      }
    } else pending.push('no main app keys: plans and Transaction Search not checked');

    if (!credentials(ctx.env, 'payouts')) pending.push('no payouts app keys');
    report.problems = problems;
    report.pending = pending;
    const file = writeOut(ctx, 'sandbox-setup.json', report);
    if (problems.length) return { status: 'failed', summary: problems[0]!, next: problems.join(' | '), outputs: [file] };
    if (pending.length) return { status: 'ok', summary: `done; ${pending.join('; ')}`, outputs: [file] };
    return { status: 'ok', summary: 'webhooks, plans and Transaction Search ready', outputs: [file] };
  },
};
