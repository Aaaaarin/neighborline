/**
 * Real-sandbox checks done by hand in the same session as a browser spike run (the buyer approving the donation
 * order, re-capture, subscription plans, cancel retries, app scopes), recorded in
 * `docs/evidence/raw/sandbox-extras-<date>.json` with the spike's `runId`. Ingest attaches the file whose runId
 * matches; SANDBOX_EVIDENCE.md and the README/DEVPOST facts then include it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { findSecrets } from '../../browser/secrets.js';

const err = z.object({ payoutItemId: z.string().optional(), httpStatus: z.number(), name: z.string(), issue: z.string().optional(), debugId: z.string().optional(), note: z.string().optional() }).passthrough();

export const ExtrasSchema = z
  .object({
    runId: z.string(),
    recordedAt: z.string(),
    source: z.string().optional(),
    orderCapture: z
      .object({
        orderId: z.string(),
        approvedBy: z.string().optional(),
        capture: z.object({ httpStatus: z.number(), orderStatus: z.string(), captureId: z.string(), captureStatus: z.string(), amount: z.object({ currency_code: z.string(), value: z.string() }), sellerReceivable: z.object({ gross: z.string(), fee: z.string(), net: z.string() }).optional(), createTime: z.string().optional() }).passthrough(),
        recapture: err.optional(),
      })
      .passthrough()
      .optional(),
    subscriptions: z
      .object({
        product: z.object({ httpStatus: z.number(), id: z.string(), name: z.string().optional() }).passthrough(),
        plans: z.array(z.object({ usd: z.string(), httpStatus: z.number(), id: z.string(), status: z.string() }).passthrough()),
      })
      .passthrough()
      .optional(),
    cancelUnclaimedRetries: z.array(err).optional(),
    webhookEventsList: z.object({ note: z.string() }).passthrough().optional(),
    appScopes: z.record(z.string()).optional(),
  })
  .passthrough();

export type SandboxExtras = z.infer<typeof ExtrasSchema>;

/** Parse one extras file; throws (without echoing values) on credential-looking data or a bad shape. */
export function parseExtras(text: string): SandboxExtras {
  const v: unknown = JSON.parse(text);
  const secrets = findSecrets(v);
  if (secrets.length) throw new Error(`refusing sandbox extras: credential-looking data at ${secrets.slice(0, 5).join('; ')}`);
  const r = ExtrasSchema.safeParse(v);
  if (!r.success) throw new Error(`not sandbox extras: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** The extras file in `<repo>/docs/evidence/raw/` recorded for this run, if any. */
export function findExtras(repo: string, runId: string): SandboxExtras | undefined {
  const dir = join(repo, 'docs/evidence/raw');
  if (!existsSync(dir)) return undefined;
  for (const f of readdirSync(dir).filter((n) => /^sandbox-extras-.*\.json$/.test(n)).sort()) {
    const x = parseExtras(readFileSync(join(dir, f), 'utf8'));
    if (x.runId === runId) return x;
  }
  return undefined;
}

const code = (s: string | undefined) => (s ? `\`${s}\`` : '');

/** Markdown section for SANDBOX_EVIDENCE.md. */
export function renderExtras(x: SandboxExtras): string[] {
  const L = ['', '## Checked by hand in the same session', '', `Recorded ${x.recordedAt}${x.source ? `; ${x.source}` : ''}. Raw: \`docs/evidence/raw/\`.`, ''];
  const oc = x.orderCapture;
  if (oc) {
    const c = oc.capture;
    L.push(`- Donation order ${code(oc.orderId)} approved by ${oc.approvedBy ?? 'a sandbox buyer'}, then captured: HTTP ${c.httpStatus}, order **${c.orderStatus}**, capture ${code(c.captureId)} **${c.captureStatus}**, ${c.amount.currency_code} ${c.amount.value}${c.sellerReceivable ? ` (PayPal fee ${c.sellerReceivable.fee}, net ${c.sellerReceivable.net})` : ''}.`);
    if (oc.recapture) L.push(`- Capturing it again: HTTP ${oc.recapture.httpStatus} \`${oc.recapture.name}\`${oc.recapture.issue ? ` / \`${oc.recapture.issue}\`` : ''} (the app treats this as "already captured", not an error).`);
  }
  const s = x.subscriptions;
  if (s) L.push(`- Monthly giving: product ${code(s.product.id)}; plans ${s.plans.map((p) => `$${p.usd} ${code(p.id)} (${p.status})`).join(', ')}.`);
  const cr = x.cancelUnclaimedRetries ?? [];
  if (cr.length) L.push(`- Cancelling the UNCLAIMED item ${code(cr[0]?.payoutItemId)}: ${cr.length} attempt(s), each HTTP ${[...new Set(cr.map((c) => `${c.httpStatus} \`${c.name}\``))].join(' / ')}${cr.some((c) => c.debugId) ? ` (debug ids ${cr.flatMap((c) => (c.debugId ? [code(c.debugId)] : [])).join(', ')})` : ''}. The app shows "PayPal couldn't cancel right now; try again", never a failure; PayPal returns unclaimed payouts on its own after 30 days.`);
  if (x.webhookEventsList) L.push(`- Webhook events list: ${x.webhookEventsList.note}.`);
  if (x.appScopes) L.push(`- Least privilege: ${Object.entries(x.appScopes).map(([k, v]) => `**${k}** ${v}`).join('; ')}.`);
  return L;
}

/** True when every cancel attempt failed with a 5xx (PayPal-side), i.e. the item could not be cancelled yet. */
export function cancelOutcome(spikeCancel: { after?: string; error?: { status?: number } } | undefined, x?: SandboxExtras): 'cancelled' | 'paypal-5xx' | 'error' | undefined {
  if (spikeCancel?.after) return 'cancelled';
  const statuses = [spikeCancel?.error?.status, ...(x?.cancelUnclaimedRetries ?? []).map((c) => c.httpStatus)].filter((n): n is number => typeof n === 'number');
  if (!statuses.length) return undefined;
  return statuses.every((n) => n >= 500) ? 'paypal-5xx' : 'error';
}
