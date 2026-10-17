/**
 * sandbox-spike: docs/PAYPAL.md "To verify in the real sandbox", automated. Resumable: every part records its result
 * in golive-out/state.json and a re-run only redoes what is unfinished (polling, the Transaction Search lag) unless
 * --force. sender_batch_ids derive from the run id, so a re-run can never pay twice.
 * Writes golive-out/sandbox-spike.json and golive-out/SANDBOX_EVIDENCE.md; on a real sandbox run also the duplicate
 * error fixture (packages/paypal) and the "Observed in the sandbox" block of PAYPAL_NOTES.md.
 */
import { join } from 'node:path';
import { rel, writeOut, type Ctx, type Step, type StepResult } from '../lib/context.js';
import { has, paypalBase, paypalTarget } from '../lib/env.js';
import { renderEvidence, type SpikeData } from '../lib/evidence.js';
import { credentials, errorShape, oauthInfo, paypalFor } from '../lib/paypal-admin.js';
import { playwrightApprover, playwrightAvailable } from '../lib/spike/buyer.js';
import { updatePaypalNotes, writeDuplicateFixture } from '../lib/spike/observed.js';
import { linkApprover, probeOrders } from '../lib/spike/orders.js';
import { createBatchRecord, phoneProbe, planBatches, pollBatch, type BatchRecord } from '../lib/spike/payouts.js';
import { probeCancelUnclaimed, probeDuplicate, probeNegative } from '../lib/spike/probes.js';
import { probeReconcile } from '../lib/spike/reconcile.js';
import { registerCapture, startReceiver, verifyCaptured } from '../lib/spike/webhook-capture.js';

const DONE = new Set(['ok', 'warn']);
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const runIdFor = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', 't').toLowerCase();

export const sandboxSpike: Step = {
  name: 'sandbox-spike',
  title: 'PayPal sandbox spike: payouts, duplicates, negative tests, Orders, webhooks, reconcile',
  async run(ctx: Ctx): Promise<StepResult> {
    if (!has(ctx.env, 'PAYPAL_PAYOUTS_CLIENT_ID', 'PAYPAL_PAYOUTS_CLIENT_SECRET')) {
      return { status: 'skipped', summary: 'no Payouts app keys', next: 'Add PAYPAL_PAYOUTS_CLIENT_ID/SECRET (docs/GOLIVE.md step 1).' };
    }
    const target = paypalTarget(ctx.env);
    const prev = ctx.state.get<Partial<SpikeData>>('sandbox-spike');
    const fresh = ctx.force || !prev.runId;
    const now = ctx.now();
    const d: SpikeData = fresh
      ? { runId: runIdFor(now), target, base: paypalBase(ctx.env), startedAt: now.toISOString(), parts: {} }
      : ({ ...prev, parts: prev.parts ?? {} } as SpikeData);
    const batches = planBatches(ctx.env, d.runId);
    if (ctx.dryRun) {
      ctx.log(`  run ${d.runId} against ${d.base} (${target})`);
      for (const b of batches) ctx.log(`  would create ${b.input.senderBatchId}: ${b.items.map((i) => i.label).join(' | ')}`);
      ctx.log('  would probe: PHONE recipient, duplicate sender_batch_id, 25 negative-testing values, cancel of the UNCLAIMED item');
      ctx.log(`  would ${credentials(ctx.env, 'main') ? 'create + approve + capture a $1 order, then reconcile with Transaction Search' : 'skip Orders and Transaction Search (no main app)'}`);
      ctx.log(`  webhook check: ${ctx.env.GOLIVE_WEBHOOK_CAPTURE_URL ? `capture via ${ctx.env.GOLIVE_WEBHOOK_CAPTURE_URL}` : 'after deploy (hosted e2e)'}`);
      return { status: 'ok', summary: `dry run: ${batches.length} batches planned (run ${d.runId})` };
    }
    const save = () => ctx.state.patch('sandbox-spike', d as unknown as Record<string, unknown>);
    const mark = (part: string, status: string, note?: string) => {
      d.parts[part] = { status, at: ctx.now().toISOString(), ...(note ? { note } : {}) };
      save();
    };
    const todo = (part: string) => !DONE.has(d.parts[part]?.status ?? '');
    const pp = paypalFor(ctx.env, 'payouts', ctx.fetch);
    const main = credentials(ctx.env, 'main') ? paypalFor(ctx.env, 'main', ctx.fetch) : null;
    if (!d.apps) {
      const [m, p] = await Promise.all([main ? oauthInfo(ctx.env, 'main', ctx.fetch) : null, oauthInfo(ctx.env, 'payouts', ctx.fetch)]);
      d.apps = { ...(m?.appId ? { main: m.appId } : {}), ...(p.appId ? { payouts: p.appId } : {}) };
    }
    save();

    // Webhook capture (optional): the receiver and subscription must exist before the payouts fire.
    const captureUrl = ctx.env.GOLIVE_WEBHOOK_CAPTURE_URL;
    let rx: Awaited<ReturnType<typeof startReceiver>> | null = null;
    let captureId: string | null = null;
    try {
      if (captureUrl && todo('webhook-capture')) {
        rx = await startReceiver(num(ctx.env.GOLIVE_WEBHOOK_CAPTURE_PORT, 4345));
        captureId = await registerCapture(pp, captureUrl);
        ctx.log(`  capture: listening on 127.0.0.1:${rx.port}, subscription ${captureId} → ${captureUrl}`);
      }

      // 1. Payout batches.
      const records: BatchRecord[] = d.batches ?? [];
      if (todo('payouts')) {
        ctx.log('  payouts: creating batches');
        for (const plan of batches) {
          const existing = records.find((r) => r.senderBatchId === plan.input.senderBatchId);
          if (existing?.batchId) continue;
          const rec = await createBatchRecord(pp, plan, ctx.now);
          ctx.log(`    ${rec.senderBatchId}: ${rec.batchId ? `${rec.batchId} ${rec.batchStatus}` : `refused ${rec.createError?.status} ${rec.createError?.name} ${rec.createError?.issue ?? ''}`}`);
          if (existing) Object.assign(existing, rec);
          else records.push(rec);
        }
        d.batches = records;
        const a = records[0];
        mark('payouts', a?.batchId ? 'ok' : 'failed', a?.batchId ? undefined : `${a?.createError?.name}: ${a?.createError?.message}`);
        if (!a?.batchId) {
          writeOut(ctx, 'sandbox-spike.json', d);
          return { status: 'failed', summary: `PayPal refused the first batch: ${a?.createError?.status} ${a?.createError?.name} ${a?.createError?.message}`, next: 'Check the Payouts app has Payouts enabled and the sandbox business account has a USD balance (docs/GOLIVE.md troubleshooting), then re-run with --force.' };
        }
      }
      if (todo('phone')) {
        const plan = { label: 'PHONE probe', input: phoneProbe(d.runId), items: [{ key: 'phone_1', label: 'PayPal wallet, PHONE', expect: 'refused in sandbox (documented)' }] };
        d.phone = await createBatchRecord(pp, plan, ctx.now);
        mark('phone', 'ok', d.phone.createError ? `refused: ${d.phone.createError.name}` : `accepted: ${d.phone.batchId}`);
      }

      // 2. Poll until settled (resumes on the next run if PayPal is slow).
      if (todo('poll')) {
        ctx.log('  poll: waiting for item statuses');
        for (const r of d.batches ?? []) {
          if (r.batchId && !r.finishedPolling) await pollBatch(pp, r, { timeoutMs: num(ctx.env.GOLIVE_POLL_SECONDS, 300) * 1000, intervalMs: num(ctx.env.GOLIVE_POLL_INTERVAL_MS, 5000), sleep: ctx.sleep, log: ctx.log });
        }
        const open = (d.batches ?? []).filter((r) => r.batchId && !r.finishedPolling);
        mark('poll', open.length ? 'pending' : 'ok', open.length ? `${open.map((r) => r.batchId).join(', ')} still moving` : undefined);
      }

      // 3. Cancel the UNCLAIMED item → RETURNED (the organizer's day-25 action).
      const unclaimed = (d.batches?.[0]?.items ?? []).find((i) => i.senderItemId?.endsWith('_unregistered') && i.status === 'UNCLAIMED');
      if (todo('cancel-unclaimed') && unclaimed) {
        d.cancel = await probeCancelUnclaimed(pp, unclaimed.payoutItemId, unclaimed.status);
        if (d.cancel.after) unclaimed.status = d.cancel.after;
        mark('cancel-unclaimed', d.cancel.after === 'RETURNED' ? 'ok' : 'warn', d.cancel.after ?? d.cancel.error?.name);
      }

      // 4. Duplicate sender_batch_id.
      const a = d.batches?.[0];
      if (todo('duplicate') && a?.batchId) {
        d.duplicate = await probeDuplicate(pp, batches[0]!, a.batchId, d.runId);
        ctx.log(`  duplicate: HTTP ${d.duplicate.reused.status} ${d.duplicate.reused.name}; detected ${d.duplicate.detectedAsDuplicate}; client → ${d.duplicate.client.batchId ?? d.duplicate.client.error}`);
        mark('duplicate', d.duplicate.ok ? 'ok' : 'warn', d.duplicate.ok ? undefined : 'the client did not resolve the duplicate to the original batch: see the fixture test in packages/paypal');
        if (target === 'sandbox') {
          const fx = writeDuplicateFixture(ctx.repo, d.duplicate, a.batchId, d.startedAt.slice(0, 10));
          if (fx) ctx.log(`  wrote ${fx} (run: pnpm --filter @neighborline/paypal test)`);
        }
      }

      // 5. Negative-testing values.
      if (todo('negative')) {
        ctx.log('  negative testing values:');
        d.negative = await probeNegative(pp, d.runId, ctx.log);
        mark('negative', 'ok', `${d.negative.length} values`);
      }

      // 6. Orders v2 (main app).
      if (todo('orders') && main) {
        const buyer = ctx.env.SANDBOX_BUYER_EMAIL && ctx.env.SANDBOX_BUYER_PASSWORD;
        const approver =
          target === 'fake'
            ? { strategy: 'link', approve: linkApprover(ctx.fetch) }
            : buyer && playwrightAvailable(ctx.repo)
              ? { strategy: 'playwright', approve: playwrightApprover({ repo: ctx.repo, email: ctx.env.SANDBOX_BUYER_EMAIL!, password: ctx.env.SANDBOX_BUYER_PASSWORD!, shotsDir: join(ctx.out, 'spike') }) }
              : { strategy: 'skip' };
        ctx.log(`  orders (${approver.strategy}):`);
        d.orders = await probeOrders(main, d.runId, approver, ctx.log);
        const captured = Boolean(d.orders.capture?.captureId);
        mark('orders', d.orders.createError ? 'failed' : captured ? 'ok' : 'warn', captured ? undefined : d.orders.approval.note);
      } else if (!main) mark('orders', 'skipped', 'no main app keys');

      // 7. Webhooks: verify a real delivery (capture), or at least list what PayPal emitted.
      const batchIds = (d.batches ?? []).map((r) => r.batchId).filter((x): x is string => Boolean(x));
      if (rx && captureId && captureUrl) {
        d.capture = await verifyCaptured(pp, rx, { url: captureUrl, webhookId: captureId, batchIds, sinceIso: new Date(Date.parse(d.startedAt) - 60_000).toISOString(), waitMs: num(ctx.env.GOLIVE_CAPTURE_WAIT_SECONDS, 90) * 1000, keep: ctx.env.GOLIVE_KEEP_CAPTURE_WEBHOOK === 'true' });
        ctx.log(`  webhook capture: ${d.capture.event ? `${d.capture.event.type} ${d.capture.event.id} → verify ${d.capture.verification}, tampered ${d.capture.tamperedVerification}` : 'no delivery'}`);
        mark('webhook-capture', d.capture.status, d.capture.verification ? `${d.capture.verification}/${d.capture.tamperedVerification}` : 'no delivery');
      }
      try {
        const list = await pp.client.request<{ events?: Array<{ id: string; event_type: string; create_time: string; resource?: unknown }> }>({ path: '/v1/notifications/webhooks-events', query: { start_time: new Date(Date.parse(d.startedAt) - 60_000).toISOString(), page_size: 100 } });
        d.events = (list.data.events ?? []).filter((e) => batchIds.some((b) => JSON.stringify(e.resource ?? {}).includes(b))).map((e) => ({ id: e.id, type: e.event_type, createTime: e.create_time }));
        mark('webhook-events', 'ok', `${d.events.length} events`);
      } catch (err) {
        mark('webhook-events', 'warn', errorShape(err).name);
      }

      // 8. Transaction Search reconcile (main app has the permission; re-run until the lag has passed).
      if (todo('reconcile')) {
        const rp = main ?? pp;
        // Transaction Search takes whole seconds: let an item processed in this very second fall inside the window.
        const newest = Math.max(0, ...(d.batches ?? []).flatMap((b) => b.items ?? []).map((i) => Date.parse(i.timeProcessed ?? '') || 0));
        if (ctx.now().getTime() - newest < 1_500) await ctx.sleep(1_500);
        d.reconcile = await probeReconcile(rp, d.batches ?? [], ctx.now(), d.reconcile);
        ctx.log(`  reconcile: ${d.reconcile.summary || d.reconcile.status}`);
        mark('reconcile', d.reconcile.status, d.reconcile.status === 'pending' ? `${d.reconcile.pendingLag.length} item(s) inside PayPal's 3 h Transaction Search lag; re-run later` : d.reconcile.error?.name);
      }
    } finally {
      await rx?.close();
    }

    // Evidence.
    const json = writeOut(ctx, 'sandbox-spike.json', d);
    const md = writeOut(ctx, 'SANDBOX_EVIDENCE.md', renderEvidence(d));
    const outputs = [rel(ctx, json), rel(ctx, md)];
    if (target === 'sandbox') {
      const notes = updatePaypalNotes(ctx.repo, d);
      if (notes) outputs.push(notes);
    }
    save();
    const statuses = Object.entries(d.parts);
    const failed = statuses.filter(([, v]) => v.status === 'failed');
    const pending = statuses.filter(([, v]) => v.status === 'pending');
    const warned = statuses.filter(([, v]) => v.status === 'warn');
    const items = (d.batches ?? []).flatMap((b) => b.items ?? []);
    const summary = `${items.map((i) => `${i.wallet[0]}:${i.status}`).join(' ')}; ${statuses.filter(([, v]) => DONE.has(v.status)).length}/${statuses.length} parts done`;
    if (failed.length) return { status: 'failed', summary, next: failed.map(([k, v]) => `${k}: ${v.note ?? 'failed'}`).join(' | '), outputs };
    if (pending.length) return { status: 'pending', summary, next: `${pending.map(([k, v]) => `${k}: ${v.note ?? 'pending'}`).join(' | ')}. Re-run: pnpm golive --only sandbox-spike`, outputs };
    return { status: warned.length ? 'warn' : 'ok', summary, ...(warned.length ? { next: warned.map(([k, v]) => `${k}: ${v.note ?? 'check'}`).join(' | ') } : {}), outputs };
  },
};
