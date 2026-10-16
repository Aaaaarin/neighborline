/**
 * Runs the real task functions in-process (ctx.run executes the child's func directly) against a
 * stub web app that implements the endpoint contract and verifies the HMAC signature.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { TaskContext, TaskDefinition } from '@renderinc/sdk/workflows';
import type { ReconcileResponse, UnclaimedItem } from './contract.js';
import { verifyInternalRequest } from './signing.js';
import { nightlyReconcile } from './tasks/reconcile.js';
import { refreshReport } from './tasks/report.js';
import { smokeTest } from './tasks/smoke.js';
import { unclaimedSweep } from './tasks/unclaimed.js';

const SECRET = 's'.repeat(40);
const calls: Array<{ path: string; body: any }> = [];
let server: Server;
let reconcileCalls = 0;

const ctx: TaskContext = {
  metadata: {},
  run: <A extends unknown[], R>(t: TaskDefinition<A, R>, ...args: A) => Promise.resolve(t.func(ctx, ...args)),
};

function unclaimed(id: string, ageH: number, extra: Partial<UnclaimedItem> = {}): UnclaimedItem {
  const t = Date.now() - ageH * 3_600_000;
  return {
    itemId: id, requestId: `req_${id}`, lang: 'es', wallet: 'VENMO', amountCents: 15000,
    payoutCreatedAt: new Date(t).toISOString(), unclaimedSince: new Date(t).toISOString(),
    nudgeCount: 0, lastNudgeAt: null, organizerAlertedAt: null, ...extra,
  };
}

before(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/api/health') return send(200, { ok: true, paypalMode: 'fake' });
    const v = verifyInternalRequest({ secret: SECRET, method: req.method ?? '', path: url.pathname, rawBody: raw, headers: req.headers as Record<string, string> });
    if (!v.ok) return send(401, v);
    const body = JSON.parse(raw);
    calls.push({ path: url.pathname, body });
    switch (url.pathname) {
      case '/api/internal/reconcile': {
        reconcileCalls++;
        // First call fails like a cold start; the task's Render-level retry would cover it. Here we just
        // assert the error surfaces as retryable.
        if (reconcileCalls === 1) return send(503, { error: 'waking up' });
        const r: ReconcileResponse = {
          window: { startDate: body.startDate, endDate: body.endDate }, checked: 2, matched: 1,
          mismatches: [{ itemId: 'it_x', kind: 'status_mismatch', local: { status: 'PENDING', amountCents: 5000 }, paypal: { status: 'SUCCESS', amountCents: 5000 } }],
          pendingLag: body.idempotencyKey.startsWith('reconcile-recheck') ? [] : [{ itemId: 'it_new', paidAt: new Date(Date.now() - 4 * 3_600_000).toISOString() }],
          fetchedTransactions: 3,
        };
        return send(200, r);
      }
      case '/api/internal/unclaimed-sweep':
        return send(200, { items: [unclaimed('a', 30), unclaimed('b', 10), unclaimed('c', 26 * 24, { nudgeCount: 5, lastNudgeAt: new Date(Date.now() - 5 * 86_400_000).toISOString() })] });
      case '/api/internal/unclaimed/renotify':
        return send(200, { sent: true, lang: 'es', channel: 'sms' });
      case '/api/internal/organizer-alert':
        return send(200, { alertId: `al_${body.idempotencyKey}`, created: true, channels: ['dashboard'] });
      case '/api/internal/report-refresh':
        return body.minNewPayouts > 1000
          ? send(200, { regenerated: false, skippedReason: 'not_due', newPayoutsSinceLast: 3, totalPayouts: 14 })
          : send(200, { regenerated: true, newPayoutsSinceLast: 6, totalPayouts: 20, reportVersion: 4, narrativeSource: 'llm' });
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.NEIGHBORLINE_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.NEIGHBORLINE_INTERNAL_SECRET = SECRET;
});

after(() => new Promise<void>((r) => server.close(() => r())));

test('nightlyReconcile: transient 503 surfaces as a retryable error', async () => {
  await assert.rejects(async () => nightlyReconcile.func(ctx), /HTTP 503 \(retryable\)/);
  // Let the sibling window calls that were already in flight finish before the next test counts calls.
  await new Promise((r) => setTimeout(r, 100));
});

test('nightlyReconcile: slices, lag recheck, deduped mismatch alert', async () => {
  calls.length = 0;
  const s = await nightlyReconcile.func(ctx);
  assert.equal(s.windows, 3);
  assert.equal(s.rechecked, 3); // one pendingLag item per slice
  assert.equal(s.mismatches.length, 1); // same item reported by every window → deduped
  assert.ok(s.alertId?.startsWith('al_reconcile_mismatch:'));
  assert.equal(calls.filter((c) => c.path === '/api/internal/reconcile').length, 4);
  assert.equal(calls.filter((c) => c.path === '/api/internal/organizer-alert').length, 1);
});

test('unclaimedSweep: nudges the 30 h item, escalates the day-26 item, ignores the 10 h item', async () => {
  calls.length = 0;
  const s = await unclaimedSweep.func(ctx);
  assert.deepEqual(s, { unclaimed: 3, renotified: 1, skipped: 0, escalated: 1, deferred: 0, failed: 0 });
  const renotify = calls.find((c) => c.path === '/api/internal/unclaimed/renotify');
  assert.deepEqual(renotify?.body, { itemId: 'a', nudgeNumber: 1, idempotencyKey: 'renotify:a:1' });
  const alert = calls.find((c) => c.path === '/api/internal/organizer-alert');
  assert.equal(alert?.body.kind, 'unclaimed_day25');
  assert.match(alert?.body.summary, /\$150\.00 Venmo payout .* still unclaimed after 25 days/);
});

test('refreshReport and smokeTest', async () => {
  const r = await refreshReport.func(ctx, { minNewPayouts: 5, reason: 'schedule' });
  assert.equal(r.regenerated, true);
  const smoke = await smokeTest.func(ctx);
  assert.equal(smoke.signedCallOk, true);
  assert.equal(smoke.health.ok, true);
});

test('wrong secret is a permanent 401', async () => {
  process.env.NEIGHBORLINE_INTERNAL_SECRET = 'w'.repeat(40);
  try {
    await assert.rejects(async () => refreshReport.func(ctx), /HTTP 401 \(permanent\)/);
  } finally {
    process.env.NEIGHBORLINE_INTERNAL_SECRET = SECRET;
  }
});
