import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASK, buildReport, checkRail, computeAmount, render } from '@neighborline/core';
import type { DbHandle } from './client.js';
import { verifyAuditChain } from './repo/audit.js';
import { getActivePolicy, getRailHandles } from './repo/groups.js';
import {
  listDonations,
  listForReport,
  listNotifications,
  listWebhookEvents,
  markNotification,
  markWebhookProcessed,
  recordDonation,
  recordNotification,
  recordWebhookEvent,
} from './repo/misc.js';
import { getTodaySpentCents } from './repo/payouts.js';
import { getHistoryForDestination, listRequests } from './repo/requests.js';
import { DEMO_GROUP, SEED_REQUESTS, seedDemo, seedTransactionId } from './seed.js';
import { GROUP_ID, freshDb, readyRequest, withGroup } from './test-db.js';

describe('webhooks, donations, notifications', () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = await freshDb();
    await withGroup(h);
  });
  afterAll(async () => h.close());

  it('dedupes webhook events by PayPal event id and keeps raw JSON', async () => {
    const ev = { id: 'WH-1', eventType: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resourceId: 'PPI-1', verified: true, raw: { id: 'WH-1', resource: { a: 1 } } };
    expect(await recordWebhookEvent(h.db, ev)).toBe(true);
    expect(await recordWebhookEvent(h.db, ev)).toBe(false);
    await markWebhookProcessed(h.db, 'WH-1');
    const [row] = await listWebhookEvents(h.db);
    expect(row).toMatchObject({ id: 'WH-1', verified: true, raw: { id: 'WH-1', resource: { a: 1 } } });
    expect(row?.processedAt).toMatch(/Z$/);
  });

  it('records donations idempotently by order id / transaction id', async () => {
    const a = await recordDonation(h.db, { groupId: GROUP_ID, amountCents: 2500, source: 'VENMO', paypalOrderId: 'ORD-1', transactionId: 'TX-1', donorKey: 'd1' });
    expect(a.created).toBe(true);
    expect(a.donation).toMatchObject({ amountCents: 2500, source: 'VENMO', status: 'COMPLETED', paypalSubscriptionId: null });
    const again = await recordDonation(h.db, { groupId: GROUP_ID, amountCents: 2500, source: 'VENMO', paypalOrderId: 'ORD-1' });
    expect(again).toEqual({ donation: a.donation, created: false });
    const byTxn = await recordDonation(h.db, { groupId: GROUP_ID, amountCents: 2500, source: 'VENMO', transactionId: 'TX-1' });
    expect(byTxn.donation.id).toBe(a.donation.id);
    await expect(recordDonation(h.db, { groupId: GROUP_ID, amountCents: -1, source: 'VENMO' })).rejects.toThrow();
    expect(await listDonations(h.db, GROUP_ID)).toHaveLength(1);
  });

  it('records notifications rendered from the vetted catalog', async () => {
    const r = await readyRequest(h, { lang: 'vi' });
    const text = render('paid', 'vi', { amount: '$150', wallet: 'Venmo' });
    const n = await recordNotification(h.db, { requestId: r.id, channel: 'sms', lang: 'vi', messageKey: 'paid', text });
    expect(n).toMatchObject({ status: 'queued', sentAt: null, text });
    await markNotification(h.db, n.id, 'sent');
    const sent = await recordNotification(h.db, { requestId: r.id, channel: 'sms', lang: 'vi', messageKey: 'paid', text, status: 'sent' });
    expect(sent.sentAt).not.toBeNull();
    const list = await listNotifications(h.db, r.id);
    expect(list.map((x) => x.status)).toEqual(['sent', 'sent']);
    await markNotification(h.db, n.id, 'failed');
    expect((await listNotifications(h.db, r.id))[0]?.sentAt).toBeNull();
  });
});

describe('seedDemo', () => {
  let h: DbHandle;
  const now = new Date('2026-10-16T17:00:00Z');
  beforeAll(async () => {
    h = await freshDb();
    const res = await seedDemo(h.db, { now });
    expect(res.alreadySeeded).toBe(false);
  });
  afterAll(async () => h.close());

  it('creates Eastside Mutual Aid with its official handles, organizers and policy v1', async () => {
    const res = await seedDemo(h.db, { now });
    expect(res.alreadySeeded).toBe(true);
    expect(res.group).toMatchObject({ id: DEMO_GROUP.id, slug: 'eastside', name: 'Eastside Mutual Aid', activePolicyId: 'pol_eastside_v1' });
    expect(res.group.officialHandles.map((x) => x.value)).toEqual(['organizers@eastside-mutualaid.org', '@eastside-mutualaid']);
    expect(res.organizers.map((o) => o.name)).toEqual(['Dana', 'Marcus']);
    expect(res.policy.version).toBe(1);
  });

  it('has ~$4,800 from 60 donors', async () => {
    const d = await listDonations(h.db, DEMO_GROUP.id);
    expect(d).toHaveLength(60);
    expect(d.reduce((a, x) => a + x.amountCents, 0)).toBe(4_800_00);
    expect(new Set(d.map((x) => x.donorKey)).size).toBe(60);
    expect(d.every((x) => new Date(x.createdAt) < now)).toBe(true);
  });

  it('pushed every seed request through the real pipeline', async () => {
    const all = await listRequests(h.db, { groupId: DEMO_GROUP.id });
    expect(all).toHaveLength(SEED_REQUESTS.length);
    expect(all.filter((r) => r.status === 'paid')).toHaveLength(25);
    expect(all.filter((r) => r.status === 'declined')).toHaveLength(1);
    for (const r of all) {
      expect(r.computed?.ruleCitation).toMatch(/^Policy v1 · /);
      expect(r.railFlags).toEqual([]);
    }
    expect(all.find((r) => r.id === 'req_seed_03')?.computed?.amountCents).toBe(8500);
    expect(all.find((r) => r.id === 'req_seed_01')?.computed?.amountCents).toBe(15000);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });

  it('produces a k-anonymous transparency report with real rows', async () => {
    const report = buildReport(await listForReport(h.db, DEMO_GROUP.id));
    expect(report.totals.inCents).toBe(4_800_00);
    expect(report.totals.donors).toBe(60);
    expect(report.k).toBe(5);
    expect(report.totals.peopleHelped).toBe(25);
    expect(report.totals.outCents).toBe(report.byWallet.reduce((a, g) => a + (g.amountCents === MASK ? 0 : g.amountCents), 0));
    const lang = Object.fromEntries(report.byLanguage.map((g) => [g.key, g.people]));
    expect(lang).toMatchObject({ vi: 5, es: 6, ht: 5, zh: MASK, ar: MASK, en: MASK });
    const cat = Object.fromEntries(report.byCategory.map((g) => [g.key, g.people]));
    expect(cat).toMatchObject({ utility_outage: 7, groceries: 9, medicine_copay: 6, transport: MASK, rent_gap: MASK });
    expect(report.unclaimed.items).toBe(25);
    expect(report.timeToCash.samples).toBe(25);
    expect(report.timeToCash.p50Seconds).toBeGreaterThan(60);
    expect(report.approvalParity.rows.find((r) => r.lang === 'vi')?.approvalRate).toBe(1);
    const tx = report.byCategory.find((g) => g.key === 'groceries')?.transactionIds;
    expect(Array.isArray(tx) && tx.includes(seedTransactionId('item:req_seed_02'))).toBe(true);
  });

  it('filters the report query by period', async () => {
    const recent = await listForReport(h.db, DEMO_GROUP.id, { from: new Date(now.getTime() - 6 * 86_400_000).toISOString() });
    expect(recent.requests.length).toBeLessThan(SEED_REQUESTS.length);
    expect(recent.period?.from).toBeDefined();
    const upto = await listForReport(h.db, DEMO_GROUP.id, { to: new Date(now.getTime() - 6 * 86_400_000).toISOString() });
    expect(upto.requests.length + recent.requests.length).toBe(SEED_REQUESTS.length);
  });

  it('supports the hero story: Mrs. Lan gets $150 and the lookalike is blocked', async () => {
    const policy = (await getActivePolicy(h.db, DEMO_GROUP.id))!;
    const handles = await getRailHandles(h.db, DEMO_GROUP.id);
    const lan = { wallet: 'VENMO' as const, type: 'USER_HANDLE' as const, value: '@lan-nguyen', nameOnFile: 'Nguyen Thi Lan' };
    const history = await getHistoryForDestination(h.db, lan, 30, { now });
    const amount = computeAmount({
      policy, extraction: { category: 'utility_outage' }, history,
      todaySpentCents: await getTodaySpentCents(h.db, DEMO_GROUP.id, { now }), destination: lan, now,
    });
    expect(amount.ok && amount.computed.amountCents).toBe(15000);
    expect(amount.ok && amount.computed.ruleCitation).toBe('Policy v1 · Utility outage · up to $150 per request');
    const spoof = { wallet: 'VENMO' as const, type: 'USER_HANDLE' as const, value: '@eastside-mutuaiaid' };
    const flags = checkRail({ destination: spoof, ...handles, history: [], policy, now });
    expect(flags.map((f) => [f.code, f.severity])).toEqual([['LOOKALIKE_HANDLE', 'block']]);
    const self = checkRail({ destination: { wallet: 'PAYPAL', type: 'EMAIL', value: 'dana@eastside-mutualaid.org' }, ...handles, history: [], policy, now });
    expect(self[0]?.code).toBe('DEST_IS_GROUP_HANDLE');
  });

  it('sees seed history for repeat households (velocity / caps work on real data)', async () => {
    const hoa = SEED_REQUESTS[0]!.dest;
    const history = await getHistoryForDestination(h.db, hoa, 30, { now });
    expect(history).toHaveLength(1);
    const policy = (await getActivePolicy(h.db, DEMO_GROUP.id))!;
    const again = computeAmount({ policy, extraction: { category: 'utility_outage' }, history, todaySpentCents: 0, destination: hoa, now });
    expect(again.ok && again.computed).toMatchObject({ amountCents: 15000, limitedBy: 'category_max' }); // $150 of $300 used → exactly $150 left
  });
});
