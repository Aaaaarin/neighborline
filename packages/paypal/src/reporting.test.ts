import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiCalls, startFake, type FakeHarness } from '../test/fake.js';
import { reconcile, type LocalPayoutItem } from './reconcile.js';
import { PayPalApiError } from './errors.js';
import { chunkDateRange, isReportingNotReady, MAX_WINDOW_MS, toRfc3339, type PayPalTransaction } from './reporting.js';

describe('chunkDateRange', () => {
  it('splits 70 days into ≤31-day, contiguous, non-overlapping windows', () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-10-10T00:00:00Z');
    const chunks = chunkDateRange(start, end);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.end.getTime() - c.start.getTime()).toBeLessThan(MAX_WINDOW_MS);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.start.getTime() - chunks[i - 1]!.end.getTime()).toBe(1000);
    expect(chunks[0]!.start).toEqual(start);
    expect(chunks.at(-1)!.end).toEqual(end);
  });
  it('keeps a short range as one window and rejects reversed ranges', () => {
    expect(chunkDateRange(new Date(0), new Date(86_400_000))).toHaveLength(1);
    expect(() => chunkDateRange(new Date(10), new Date(0))).toThrow(RangeError);
  });
  it('formats RFC 3339 with seconds and no millis', () => {
    expect(toRfc3339(new Date('2026-10-16T12:34:56.789Z'))).toBe('2026-10-16T12:34:56Z');
  });
});

const txn = (id: string, cents: number, code = 'T0001'): PayPalTransaction => ({
  transactionId: id,
  paypalReferenceId: undefined,
  eventCode: code,
  initiationDate: '2026-10-16T00:00:00+0000',
  updatedDate: undefined,
  amountCents: cents,
  currency: 'USD',
  feeCents: undefined,
  status: 'S',
  customField: undefined,
  invoiceId: undefined,
  payerEmail: undefined,
  raw: {},
});
const local = (id: string, transactionId: string | undefined, amountCents: number, lastEventAt = '2026-10-15T00:00:00Z'): LocalPayoutItem => ({ id, transactionId, amountCents, status: 'SUCCESS', lastEventAt });

describe('reconcile (pure)', () => {
  const asOf = new Date('2026-10-16T12:00:00Z');
  it('classifies matched, mismatch, missing on either side, lag, and untracked items', () => {
    const r = reconcile(
      [
        local('a', 'TXN-A', 15000),
        local('b', 'TXN-B', 12000),
        local('c', 'TXN-C', 5000),
        local('d', 'TXN-D', 5000, '2026-10-16T11:00:00Z'),
        local('e', undefined, 5000),
      ],
      [txn('TXN-A', -15000), txn('TXN-B', -12500), txn('TXN-X', -9900), txn('DONATION-1', 2500, 'T0006')],
      { asOf },
    );
    expect(r.matched.map((m) => m.local.id)).toEqual(['a']);
    expect(r.amountMismatch.map((m) => [m.local.id, m.diffCents])).toEqual([['b', 500]]);
    expect(r.missingAtPayPal.map((i) => i.id)).toEqual(['c']);
    expect(r.pendingLag.map((i) => i.id)).toEqual(['d']);
    expect(r.missingLocally.map((t) => t.transactionId)).toEqual(['TXN-X']); // donations (T0006) are not payouts
    expect(r.noTransactionId.map((i) => i.id)).toEqual(['e']);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('1 within 3h reporting lag');
  });
  it('detects status drift between our item and PayPal transaction_status', () => {
    const t = (id: string, status: string) => ({ ...txn(id, -100), status });
    const items: LocalPayoutItem[] = [
      { id: 'paid-but-reversed', transactionId: 'T1', amountCents: 100, status: 'SUCCESS' },
      { id: 'returned-but-success', transactionId: 'T2', amountCents: 100, status: 'RETURNED' },
      { id: 'paid-ok', transactionId: 'T3', amountCents: 100, status: 'SUCCESS' },
      { id: 'unclaimed-pending', transactionId: 'T4', amountCents: 100, status: 'UNCLAIMED' },
    ];
    const r = reconcile(items, [t('T1', 'V'), t('T2', 'S'), t('T3', 'S'), t('T4', 'P')], { asOf });
    expect(r.statusDrift.map((d) => d.local.id)).toEqual(['paid-but-reversed', 'returned-but-success']);
    expect(r.statusDrift[0]!.detail).toContain('reversed');
    expect(r.matched.map((m) => m.local.id)).toEqual(['paid-ok', 'unclaimed-pending']);
    expect(r.ok).toBe(false);
  });
  it('flags a currency mismatch and items stuck PENDING without a transaction id', () => {
    const r = reconcile(
      [local('a', 'T1', 100), { id: 'stuck', amountCents: 100, status: 'PENDING', lastEventAt: '2026-10-14T00:00:00Z' }, { id: 'fresh', amountCents: 100, status: 'PENDING', lastEventAt: '2026-10-16T11:00:00Z' }],
      [{ ...txn('T1', -100), currency: 'EUR' }],
      { asOf },
    );
    expect(r.currencyMismatch.map((m) => m.local.id)).toEqual(['a']);
    expect(r.stuckPending.map((i) => i.id)).toEqual(['stuck']);
    expect(r.ok).toBe(false);
  });
  it('is ok when everything lines up', () => {
    expect(reconcile([local('a', 'T1', 100)], [txn('T1', -100)], { asOf }).ok).toBe(true);
  });
});

describe('ReportingApi + reconcile against fake-paypal', () => {
  let h: FakeHarness;
  beforeAll(async () => {
    h = await startFake();
  });
  afterEach(() => {
    h.fake.reset();
    h.calls.length = 0;
  });
  afterAll(() => h.close());

  it('chunks a 70-day search into 3 calls and reconciles a processed batch', async () => {
    const res = await h.paypal.payouts.createBatch({
      senderBatchId: 'nl_rec',
      items: [
        { senderItemId: 'r1', amountCents: 15000, receiver: 'a@example.com', recipientType: 'EMAIL' },
        { senderItemId: 'r2', amountCents: 9000, receiver: 'b@blocked.example', recipientType: 'EMAIL' },
      ],
    });
    await h.control(`/__fake/batches/${res.batchId}/process`);
    const items = await h.paypal.payouts.listAllItems(res.batchId);
    const now = Date.now();
    const txns = await h.paypal.reporting.searchTransactions({ startDate: new Date(now - 70 * 86_400_000), endDate: new Date(now + 60_000), pageSize: 1 });
    expect(apiCalls(h, '/v1/reporting/transactions').length).toBeGreaterThanOrEqual(3);
    expect(txns.map((t) => [t.eventCode, t.amountCents])).toEqual([['T0001', -15000]]);
    const report = reconcile(
      items.map((i) => ({ id: i.senderItemId!, transactionId: i.transactionId, amountCents: i.amountCents, status: i.status, lastEventAt: i.timeProcessed })),
      txns,
    );
    expect(report.ok).toBe(true);
    expect(report.matched.map((m) => m.local.id)).toEqual(['r1']);
    expect(report.noTransactionId.map((i) => i.id)).toEqual(['r2']); // BLOCKED: PayPal never created a transaction
  });
});

describe('isReportingNotReady (observed 2026-10-28 on a brand-new sandbox account)', () => {
  let h: FakeHarness;
  beforeAll(async () => {
    h = await startFake({ reportingNotReady: true });
  });
  afterAll(() => h.close());

  it('classifies 404 INVALID_REQUEST "Data for the given start date is not available." as reporting lag', async () => {
    const err = await h.paypal.reporting.searchTransactions({ startDate: new Date(Date.now() - 86_400_000), endDate: new Date() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).status).toBe(404);
    expect(isReportingNotReady(err)).toBe(true);
  });

  it('does not classify other failures as lag', () => {
    const mk = (status: number, body: unknown, path = '/v1/reporting/transactions') => new PayPalApiError({ status, body, method: 'GET', path });
    expect(isReportingNotReady(mk(404, { name: 'INVALID_REQUEST', message: 'Data for the given start date is not available.' }))).toBe(true);
    expect(isReportingNotReady(mk(403, { name: 'NOT_AUTHORIZED', message: 'Authorization failed due to insufficient permissions.' }))).toBe(false);
    expect(isReportingNotReady(mk(400, { name: 'INVALID_REQUEST', message: 'Date range is greater than 31 days.' }))).toBe(false);
    expect(isReportingNotReady(mk(500, { name: 'INTERNAL_SERVER_ERROR' }))).toBe(false);
    expect(isReportingNotReady(mk(404, { name: 'INVALID_REQUEST' }, '/v1/payments/payouts/X'))).toBe(false);
    expect(isReportingNotReady(new Error('Data for the given start date is not available.'))).toBe(false);
  });
});
