import { describe, expect, it } from 'vitest';
import { MASK, buildReport, percentile, type ReportDonationRow, type ReportItemRow, type ReportRequestRow } from './report.js';
import type { RequestStatus } from './schemas.js';

const T0 = Date.parse('2026-10-01T12:00:00Z');
const at = (sec: number): string => new Date(T0 + sec * 1000).toISOString();

let n = 0;
function paidReq(lang: string, ruleKey: string, household: string, amountCents: number, ttcSec: number, wallet: 'PAYPAL' | 'VENMO' = 'VENMO') {
  n += 1;
  const id = `r${n}`;
  const req: ReportRequestRow = { id, lang, ruleKey, createdAt: at(n * 1000), status: 'paid', householdKey: household };
  const item: ReportItemRow = {
    requestId: id, amountCents, wallet, status: 'SUCCESS', successAt: at(n * 1000 + ttcSec), wasUnclaimed: false, transactionId: `TX${n}`,
  };
  return { req, item };
}
const donation = (amountCents: number, donorKey: string | null, source = 'PAYPAL', atIso = at(0)): ReportDonationRow => ({
  amountCents, at: atIso, source, donorKey, transactionId: `D-${donorKey ?? 'anon'}-${amountCents}`,
});

function fixture() {
  n = 0;
  const rows = [
    paidReq('vi', 'utility_outage', 'h1', 15000, 80),
    paidReq('vi', 'utility_outage', 'h2', 15000, 95),
    paidReq('vi', 'groceries', 'h3', 10000, 120),
    paidReq('es', 'groceries', 'h4', 8000, 70, 'PAYPAL'),
    paidReq('es', 'groceries', 'h5', 10000, 300, 'PAYPAL'),
    paidReq('es', 'rent_gap', 'h6', 25000, 600, 'PAYPAL'),
    paidReq('ht', 'medicine_copay', 'h7', 12000, 100), // single Haitian household → must be masked
  ];
  const requests = rows.map((r) => r.req);
  const items = rows.map((r) => r.item);
  // h5's item was unclaimed first, then claimed after help
  items[4] = { ...items[4]!, wasUnclaimed: true };
  // a still-pending unclaimed + a declined request + an awaiting one
  requests.push({ id: 'r_unc', lang: 'es', ruleKey: 'groceries', createdAt: at(9000), status: 'unclaimed', householdKey: 'h8' });
  items.push({ requestId: 'r_unc', amountCents: 5000, wallet: 'PAYPAL', status: 'UNCLAIMED', successAt: null, wasUnclaimed: true, transactionId: null });
  requests.push({ id: 'r_dec', lang: 'vi', ruleKey: 'other', createdAt: at(9100), status: 'declined', householdKey: 'h9' });
  requests.push({ id: 'r_wait', lang: 'vi', ruleKey: 'groceries', createdAt: at(9200), status: 'awaiting_approval', householdKey: 'h10' });
  const donations = [
    ...Array.from({ length: 5 }, (_, i) => donation(10000, `donor${i}`)),
    donation(2500, null, 'VENMO'),
    donation(2500, null, 'VENMO'),
    donation(2500, 'venmo-donor', 'VENMO'),
    donation(99900, 'big', 'SUBSCRIPTION'),
  ];
  return { requests, items, donations };
}

describe('percentile (nearest rank)', () => {
  it('computes p50/p90', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([42], 0.9)).toBe(42);
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 1)).toBe(3);
  });
  it('rejects empty sets and bad p', () => {
    expect(() => percentile([], 0.5)).toThrow();
    expect(() => percentile([1], 1.5)).toThrow();
  });
});

describe('buildReport', () => {
  const r = buildReport(fixture());

  it('totals money in and out', () => {
    expect(r.totals.inCents).toBe(5 * 10000 + 3 * 2500 + 99900);
    expect(r.totals.donations).toBe(9);
    expect(r.totals.donors).toBe(9); // two anonymous donations count as two donors
    expect(r.totals.outCents).toBe(15000 + 15000 + 10000 + 8000 + 10000 + 25000 + 12000);
    expect(r.totals.paidPayouts).toBe(7);
    expect(r.totals.peopleHelped).toBe(7);
    expect(r.totals.inFlightCents).toBe(5000);
    expect(r.totals.balanceCents).toBe(157400 - 95000 - 5000);
  });

  it('masks groups with fewer than 3 people (k-anonymity)', () => {
    const ht = r.byLanguage.find((g) => g.key === 'ht')!;
    expect(ht).toEqual({ key: 'ht', people: MASK, payouts: MASK, amountCents: MASK });
    const vi = r.byLanguage.find((g) => g.key === 'vi')!;
    expect(vi).toEqual({ key: 'vi', people: 3, payouts: 3, amountCents: 40000 });
    expect(r.byCategory.find((g) => g.key === 'medicine_copay')!.transactionIds).toBe(MASK);
    const util = r.byCategory.find((g) => g.key === 'utility_outage')!;
    expect(util.amountCents).toBe(MASK); // only 2 households
    const groceries = r.byCategory.find((g) => g.key === 'groceries')!;
    expect(groceries).toMatchObject({ people: 3, amountCents: 28000, transactionIds: ['TX3', 'TX4', 'TX5'] });
  });

  it('groups by wallet and donation source', () => {
    expect(r.byWallet.map((g) => [g.key, g.people])).toEqual([['PAYPAL', 3], ['VENMO', 4]]);
    const src = Object.fromEntries(r.donationsBySource.map((g) => [g.key, g.amountCents]));
    expect(src).toEqual({ PAYPAL: 50000, SUBSCRIPTION: MASK, VENMO: 7500 });
  });

  it('computes time-to-cash p50/p90 in seconds', () => {
    // durations: 80, 95, 120, 70, 300, 600, 100 → sorted 70,80,95,100,120,300,600
    expect(r.timeToCash).toEqual({ samples: 7, p50Seconds: 100, p90Seconds: 600 });
  });

  it('builds the approvals-by-language parity table', () => {
    // decided: 7 paid + unclaimed (approved) + 1 declined = 9; approved 8
    expect(r.approvalParity.overallRate).toBe(0.889);
    const vi = r.approvalParity.rows.find((x) => x.lang === 'vi')!;
    expect(vi).toMatchObject({ people: 4, submitted: 5, approved: 3, declined: 1, approvalRate: 0.75, gapFromOverall: -0.139 });
    const es = r.approvalParity.rows.find((x) => x.lang === 'es')!;
    expect(es).toMatchObject({ people: 4, approved: 4, declined: 0, approvalRate: 1 });
    const ht = r.approvalParity.rows.find((x) => x.lang === 'ht')!;
    expect(ht.approvalRate).toBe(MASK);
    expect(ht.gapFromOverall).toBe(MASK);
  });

  it('reports unclaimed with small-cell suppression', () => {
    // 2 households ever unclaimed (<3) → counts and rate masked
    expect(r.unclaimed).toEqual({ items: 8, everUnclaimed: MASK, claimedAfterHelp: MASK, rate: MASK });
    const f = fixture();
    f.items = f.items.map((i) => ({ ...i, wasUnclaimed: true }));
    const r2 = buildReport(f);
    expect(r2.unclaimed).toEqual({ items: 8, everUnclaimed: 8, claimedAfterHelp: 7, rate: 1 });
  });

  it('shows an unmasked 0 rate when nobody was unclaimed', () => {
    const f = fixture();
    f.items = f.items.filter((i) => i.status !== 'UNCLAIMED').map((i) => ({ ...i, wasUnclaimed: false }));
    expect(buildReport(f).unclaimed.rate).toBe(0);
  });

  it('never outputs a number describing fewer than k people anywhere', () => {
    const json = JSON.stringify(buildReport(fixture()));
    expect(json).not.toContain('"h7"');
    expect(json).not.toContain('TX7');
  });

  it('filters by period', () => {
    const f = fixture();
    const r3 = buildReport({ ...f, period: { from: at(2500), to: at(6500) } }); // r3..r6
    expect(r3.totals.paidPayouts).toBe(4);
    expect(r3.period).toEqual({ from: at(2500), to: at(6500) });
    expect(r3.totals.inCents).toBe(MASK); // donations at t0 excluded → 0 donors
  });

  it('handles empty input', () => {
    const e = buildReport({ requests: [], items: [], donations: [] });
    expect(e.totals).toEqual({
      inCents: MASK, donations: MASK, donors: MASK, outCents: MASK, paidPayouts: MASK, peopleHelped: MASK, inFlightCents: MASK, balanceCents: 0,
    });
    expect(e.timeToCash).toEqual({ samples: MASK, p50Seconds: null, p90Seconds: null });
    expect(e.byCategory).toEqual([]);
    expect(e.approvalParity).toEqual({ overallRate: MASK, rows: [] });
  });

  it('supports a custom k and validates it', () => {
    expect(buildReport({ ...fixture(), k: 1 }).byLanguage.find((g) => g.key === 'ht')!.people).toBe(1);
    expect(() => buildReport({ ...fixture(), k: 0 })).toThrow();
  });

  it('falls back to request id when there is no household key, and other for no rule', () => {
    const f = fixture();
    f.requests = f.requests.map((q) => ({ ...q, householdKey: null, ruleKey: q.lang === 'ht' ? null : q.ruleKey }));
    const r4 = buildReport(f);
    expect(r4.totals.peopleHelped).toBe(7);
    expect(r4.byCategory.some((g) => g.key === 'other')).toBe(true);
  });

  it('ignores items whose request is outside the data set and negative/invalid durations', () => {
    const f = fixture();
    f.items.push({ requestId: 'ghost', amountCents: 1, wallet: 'VENMO', status: 'SUCCESS', successAt: at(1), wasUnclaimed: false, transactionId: 'G' });
    f.items[0] = { ...f.items[0]!, successAt: at(-5) };
    const r5 = buildReport(f);
    expect(r5.totals.paidPayouts).toBe(7);
    expect(r5.timeToCash.samples).toBe(6);
  });

  it('counts the same household once across categories', () => {
    const f = fixture();
    f.requests = f.requests.map((q) => ({ ...q, householdKey: 'same' as string }));
    expect(buildReport(f).totals.peopleHelped).toBe(MASK);
    const statuses: RequestStatus[] = f.requests.map((q) => q.status);
    expect(statuses).toContain('paid');
  });
});
