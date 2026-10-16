/**
 * /api/internal/* (Render Workflows → web) and /api/health, against the real engine + approver.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit, verifyAuditChain } from '@neighborline/db';
import { signedHeaders } from '../lib/server/internal-auth';
import { startHarness, waitFor, type Harness } from './harness';

const SECRET = 'internal-test-secret-0123456789abcdefghijklmnop';
let h: Harness;
beforeAll(async () => {
  process.env.NEIGHBORLINE_INTERNAL_SECRET = SECRET;
  h = await startHarness();
  globalThis.__neighborlineServices = h.engine; // the route handlers' services() singleton
});
afterAll(async () => {
  globalThis.__neighborlineServices = undefined;
  await h?.close();
});

const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;
const ops = () => h.engine.internal;

async function callRoute(mod: { POST: (req: Request) => Promise<Response> }, path: string, body: unknown, opts: { secret?: string; sign?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.sign !== false) Object.assign(headers, signedHeaders(opts.secret ?? SECRET, 'POST', path, raw));
  const res = await mod.POST(new Request(`http://localhost${path}`, { method: 'POST', headers, body: raw }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function unclaimedRosa(): Promise<{ requestId: string; itemId: string }> {
  const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_voice' });
  await h.engine.submitAudio(requestId, { sampleId: 'rosa' });
  await h.engine.confirmIntake(requestId, { confirmed: true });
  await h.engine.approve({ requestIds: [requestId], organizerId: 'org_dana', signer: { kind: 'demo_key' } });
  await h.engine.approve({ requestIds: [requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } });
  const v = await waitFor(async () => {
    const r = await h.engine.getRequest(requestId);
    return r?.payout?.item.status === 'UNCLAIMED' ? r : null;
  }, 15_000, 'UNCLAIMED');
  return { requestId, itemId: v.payout!.item.id };
}

describe('contract drift', () => {
  it('internal-contract.ts and internal-auth.ts match the workflows package', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    expect(read('../lib/server/internal-contract.ts')).toBe(read('../../../workflows/src/contract.ts'));
    const body = (s: string) => s.slice(s.indexOf("import { createHmac"));
    expect(body(read('../lib/server/internal-auth.ts'))).toBe(body(read('../../../workflows/src/signing.ts')));
  });
});

describe('/api/internal/* auth', () => {
  it('rejects unsigned, wrongly signed and replayed-to-another-route requests with 401', async () => {
    const mod = await import('../app/api/internal/unclaimed-sweep/route');
    const path = '/api/internal/unclaimed-sweep';
    const body = { now: new Date().toISOString(), minAgeHours: 0 };
    expect((await callRoute(mod, path, body, { sign: false })).status).toBe(401);
    expect((await callRoute(mod, path, body, { secret: 'x'.repeat(48) })).status).toBe(401);
    const raw = JSON.stringify(body);
    const res = await mod.POST(
      new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...signedHeaders(SECRET, 'POST', '/api/internal/reconcile', raw) }, body: raw }),
    );
    expect(res.status).toBe(401);
    const ok = await callRoute(mod, path, body);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.json.items)).toBe(true);
  });

  it('validates bodies (400) after authenticating', async () => {
    const mod = await import('../app/api/internal/organizer-alert/route');
    const r = await callRoute(mod, '/api/internal/organizer-alert', { kind: 'nope' });
    expect(r.status).toBe(400);
  });
});

describe('background jobs', () => {
  it('unclaimed sweep → renotify in the neighbor’s language, once per key; skipped once claimed', async () => {
    const { requestId, itemId } = await unclaimedRosa();
    const sweep = await ops().unclaimedSweep({ now: new Date().toISOString(), minAgeHours: 0 });
    const row = sweep.items.find((i) => i.itemId === itemId)!;
    expect(row).toMatchObject({ requestId, lang: 'es', wallet: 'PAYPAL', nudgeCount: 0, lastNudgeAt: null, organizerAlertedAt: null });
    expect(Date.parse(row.unclaimedSince)).toBeGreaterThan(0);
    expect((await ops().unclaimedSweep({ now: new Date().toISOString(), minAgeHours: 24 })).items.find((i) => i.itemId === itemId)).toBeUndefined();

    const key = `renotify:${itemId}:1`;
    const first = await ops().renotify({ itemId, nudgeNumber: 1, idempotencyKey: key });
    expect(first).toMatchObject({ sent: true, lang: 'es' });
    const again = await ops().renotify({ itemId, nudgeNumber: 1, idempotencyKey: key });
    expect(again).toMatchObject({ sent: false, skippedReason: 'duplicate' });
    const t = (await h.engine.getThread(requestId))!;
    expect(t.messages.filter((m) => m.kind === 'claim_help').length).toBeGreaterThanOrEqual(2);
    expect((await ops().unclaimedSweep({ now: new Date().toISOString(), minAgeHours: 0 })).items.find((i) => i.itemId === itemId)!.nudgeCount).toBe(1);

    const alert = await ops().organizerAlert({ kind: 'unclaimed_day25', idempotencyKey: `day25:${itemId}`, itemIds: [itemId], summary: 'Unclaimed for 25 days: rosa.m.delgado@example.com', deadline: new Date().toISOString() });
    expect(alert).toMatchObject({ created: true, channels: ['organizer_queue', 'ledger'] });
    expect(await ops().organizerAlert({ kind: 'unclaimed_day25', idempotencyKey: `day25:${itemId}`, itemIds: [itemId], summary: 'x' })).toMatchObject({ created: false, alertId: alert.alertId });
    const g = await h.engine.getGroup();
    expect(g.alerts?.[0]).toMatchObject({ id: alert.alertId, kind: 'unclaimed_day25', itemIds: [itemId] });
    expect(g.alerts?.[0]?.summary).not.toContain('rosa.m.delgado'); // PII redacted
    expect((await h.engine.getLedger()).alerts?.[0]?.id).toBe(alert.alertId);
    expect((await ops().unclaimedSweep({ now: new Date().toISOString(), minAgeHours: 0 })).items.find((i) => i.itemId === itemId)!.organizerAlertedAt).toBeTruthy();

    // She claims → the next follow-up is skipped.
    const paypalItemId = (await h.engine.getRequest(requestId))!.payout!.item.paypalItemId!;
    await fetch(`${h.fake.url}/__fake/claim/${paypalItemId}`, { method: 'POST' });
    await waitFor(async () => (await h.engine.getRequest(requestId))?.payout?.item.status === 'SUCCESS', 10_000, 'claimed');
    expect(await ops().renotify({ itemId, nudgeNumber: 2, idempotencyKey: `renotify:${itemId}:2` })).toEqual({ sent: false, skippedReason: 'no_longer_unclaimed' });
    expect((await verifyAuditChain(await db())).ok).toBe(true);
  });

  it('reconciles one window against Transaction Search, classifying fresh items as pendingLag', async () => {
    const run = await h.engine.playScenario({ scenario: 'lan', mode: 'auto', speed: 20 });
    await waitFor(async () => (await h.engine.getRequest(run.requestId))?.request.status === 'paid', 15_000, 'paid');
    const end = new Date(Date.now() + 60_000);
    const start = new Date(end.getTime() - 86_400_000);
    const r = await ops().reconcileWindow({ startDate: start.toISOString(), endDate: end.toISOString(), lagHours: 0, idempotencyKey: 'reconcile:test' });
    expect(r.checked).toBeGreaterThan(0);
    expect(r.matched).toBeGreaterThan(0);
    expect(r.mismatches.filter((m) => m.kind === 'amount_mismatch')).toEqual([]);
    const lagged = await ops().reconcileWindow({ startDate: start.toISOString(), endDate: end.toISOString(), lagHours: 3, idempotencyKey: 'reconcile:test-lag' });
    expect(lagged.pendingLag.length + lagged.matched).toBeGreaterThan(0);
    const rows = (await listAudit(await db())).filter((e) => e.action === 'reconcile.window');
    expect(rows.map((e) => e.data.idempotencyKey)).toEqual(['reconcile:test', 'reconcile:test-lag']);
    await ops().reconcileWindow({ startDate: start.toISOString(), endDate: end.toISOString(), lagHours: 0, idempotencyKey: 'reconcile:test' });
    expect((await listAudit(await db())).filter((e) => e.action === 'reconcile.window')).toHaveLength(2); // retry: no new row
    await expect(ops().reconcileWindow({ startDate: end.toISOString(), endDate: start.toISOString(), lagHours: 0, idempotencyKey: 'x' })).rejects.toMatchObject({ status: 400 });
  });

  it('report refresh: regenerates when forced or due, otherwise answers not_due quickly', async () => {
    const forced = await ops().reportRefresh({ minNewPayouts: 5, force: true, reason: 'manual' });
    expect(forced).toMatchObject({ regenerated: true, reportVersion: 1 });
    expect(['llm', 'template']).toContain(forced.narrativeSource);
    const notDue = await ops().reportRefresh({ minNewPayouts: 5, force: false, reason: 'schedule' });
    expect(notDue).toMatchObject({ regenerated: false, skippedReason: 'not_due', newPayoutsSinceLast: 0 });
    // /report serves the stored version while nothing new was paid.
    expect((await h.engine.getReport()).generatedAt).toBe(forced.generatedAt);
  });

  it('GET /api/health is fast and reports the approver without secrets', async () => {
    const { GET } = await import('../app/api/health/route');
    const t0 = Date.now();
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(body).toMatchObject({ ok: true, paypalMode: 'fake', aiMode: 'fixture', approver: 'up' });
  });
});
