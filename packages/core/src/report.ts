/**
 * Transparency report aggregation. Aggregate-only, k-anonymous: any group describing fewer than
 * k (default 5) distinct people/donors is reported as "<k" — counts, sums and rates alike. Five, not
 * three: in a neighborhood-sized group, three people who asked for a heater the same week can still
 * be recognised by their neighbors.
 */
import type { PayoutItemStatus, RequestStatus, Wallet } from './schemas.js';

export const K_ANON_MIN = 5;
export const MASK = '<k' as const;
export type Masked<T> = T | typeof MASK;

export interface ReportRequestRow {
  id: string;
  lang: string;
  ruleKey: string | null;
  createdAt: string;
  status: RequestStatus;
  /** Normalized payout destination (see identity.destinationKey); falls back to request id. */
  householdKey: string | null;
}
export interface ReportItemRow {
  requestId: string;
  amountCents: number;
  wallet: Wallet;
  status: PayoutItemStatus;
  /** When the item first reached SUCCESS. */
  successAt: string | null;
  /** True if the item was ever UNCLAIMED (even if later claimed). */
  wasUnclaimed: boolean;
  transactionId: string | null;
}
export interface ReportDonationRow {
  amountCents: number;
  at: string;
  source: string;
  donorKey: string | null;
  transactionId: string | null;
}
export interface ReportInput {
  requests: readonly ReportRequestRow[];
  items: readonly ReportItemRow[];
  donations: readonly ReportDonationRow[];
  period?: { from?: string; to?: string };
  k?: number;
}

export interface GroupRow {
  key: string;
  people: Masked<number>;
  payouts: Masked<number>;
  amountCents: Masked<number>;
  /**
   * PayPal transaction ids backing the row. Only present on ONE dimension (category, and donation
   * source) — listing them per language/wallet too would let a reader difference a masked row out.
   */
  transactionIds?: Masked<string[]>;
}
export interface ParityRow {
  lang: string;
  people: Masked<number>;
  submitted: Masked<number>;
  approved: Masked<number>;
  declined: Masked<number>;
  approvalRate: Masked<number>;
  /** approvalRate − overall rate, in percentage points (e.g. -0.05 = 5 points below). */
  gapFromOverall: Masked<number>;
}
export interface TransparencyReport {
  period: { from: string | null; to: string | null };
  k: number;
  totals: {
    inCents: Masked<number>;
    donations: Masked<number>;
    donors: Masked<number>;
    outCents: Masked<number>;
    paidPayouts: Masked<number>;
    peopleHelped: Masked<number>;
    inFlightCents: Masked<number>;
    balanceCents: number;
  };
  donationsBySource: GroupRow[];
  byCategory: GroupRow[];
  byLanguage: GroupRow[];
  byWallet: GroupRow[];
  timeToCash: { samples: Masked<number>; p50Seconds: Masked<number> | null; p90Seconds: Masked<number> | null };
  approvalParity: { overallRate: Masked<number>; rows: ParityRow[] };
  unclaimed: { items: Masked<number>; everUnclaimed: Masked<number>; claimedAfterHelp: Masked<number>; rate: Masked<number> };
}

const APPROVED_STATES: ReadonlySet<RequestStatus> = new Set<RequestStatus>([
  'approved', 'paying', 'paid', 'unclaimed', 'returned', 'failed',
]);
const IN_FLIGHT: ReadonlySet<PayoutItemStatus> = new Set<PayoutItemStatus>(['PENDING', 'ONHOLD', 'UNCLAIMED']);

/** Nearest-rank percentile of a non-empty array. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentile of empty set');
  if (p < 0 || p > 1) throw new RangeError('p must be within [0,1]');
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx] as number;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const inPeriod = (iso: string, from?: string, to?: string): boolean => {
  const t = Date.parse(iso);
  return !(from && t < Date.parse(from)) && !(to && t >= Date.parse(to));
};

export function buildReport(input: ReportInput): TransparencyReport {
  const k = input.k ?? K_ANON_MIN;
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a positive integer');
  const { from, to } = input.period ?? {};
  const mask = <T>(people: number, v: T): Masked<T> => (people < k ? MASK : v);

  const requests = input.requests.filter((r) => inPeriod(r.createdAt, from, to));
  const reqById = new Map(requests.map((r) => [r.id, r]));
  const items = input.items.filter((i) => reqById.has(i.requestId));
  const donations = input.donations.filter((d) => inPeriod(d.at, from, to));
  const person = (r: ReportRequestRow): string => r.householdKey ?? `req:${r.id}`;

  const paid = items.filter((i) => i.status === 'SUCCESS');
  const groupBy = (
    rows: readonly ReportItemRow[],
    keyOf: (i: ReportItemRow, r: ReportRequestRow) => string,
    withIds = false,
  ): GroupRow[] => {
    const groups = new Map<string, ReportItemRow[]>();
    for (const i of rows) {
      const key = keyOf(i, reqById.get(i.requestId) as ReportRequestRow);
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, g]) => {
        const people = new Set(g.map((i) => person(reqById.get(i.requestId) as ReportRequestRow))).size;
        const row: GroupRow = {
          key,
          people: mask(people, people),
          payouts: mask(people, g.length),
          amountCents: mask(people, g.reduce((a, i) => a + i.amountCents, 0)),
        };
        if (withIds) row.transactionIds = mask(people, g.map((i) => i.transactionId).filter((t): t is string => !!t).sort());
        return row;
      });
  };

  // Donations: "people" are distinct donors (anonymous donations count individually).
  const donorKey = (d: ReportDonationRow, idx: number): string => d.donorKey ?? `anon:${idx}`;
  const donors = new Set(donations.map(donorKey)).size;
  const bySource = new Map<string, Array<[ReportDonationRow, number]>>();
  donations.forEach((d, idx) => bySource.set(d.source, [...(bySource.get(d.source) ?? []), [d, idx]]));
  const donationsBySource: GroupRow[] = [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => {
      const people = new Set(g.map(([d, idx]) => donorKey(d, idx))).size;
      return {
        key,
        people: mask(people, people),
        payouts: mask(people, g.length),
        amountCents: mask(people, g.reduce((a, [d]) => a + d.amountCents, 0)),
        transactionIds: mask(people, g.map(([d]) => d.transactionId).filter((t): t is string => !!t).sort()),
      };
    });

  const inCents = donations.reduce((a, d) => a + d.amountCents, 0);
  const outCents = paid.reduce((a, i) => a + i.amountCents, 0);
  const inFlightCents = items.filter((i) => IN_FLIGHT.has(i.status)).reduce((a, i) => a + i.amountCents, 0);
  const helped = new Set(paid.map((i) => person(reqById.get(i.requestId) as ReportRequestRow))).size;
  const withItems = new Set(items.map((i) => person(reqById.get(i.requestId) as ReportRequestRow))).size;

  // Time to cash: request created → first SUCCESS.
  const durations = paid
    .filter((i) => i.successAt)
    .map((i) => (Date.parse(i.successAt as string) - Date.parse((reqById.get(i.requestId) as ReportRequestRow).createdAt)) / 1000)
    .filter((s) => Number.isFinite(s) && s >= 0);
  const ttcPeople = new Set(
    paid.filter((i) => i.successAt).map((i) => person(reqById.get(i.requestId) as ReportRequestRow)),
  ).size;

  // Approval parity by language.
  const decided = requests.filter((r) => APPROVED_STATES.has(r.status) || r.status === 'declined');
  const decidedPeople = new Set(decided.map(person)).size;
  const approvedAll = decided.filter((r) => APPROVED_STATES.has(r.status)).length;
  const overall = decided.length ? approvedAll / decided.length : 0;
  const langs = [...new Set(requests.map((r) => r.lang))].sort();
  const parityRows: ParityRow[] = langs.map((lang) => {
    const rs = requests.filter((r) => r.lang === lang);
    const ds = rs.filter((r) => APPROVED_STATES.has(r.status) || r.status === 'declined');
    const people = new Set(ds.map(person)).size;
    const approved = ds.filter((r) => APPROVED_STATES.has(r.status)).length;
    const submitted = rs.filter((r) => r.status === 'awaiting_approval').length + ds.length;
    const rate = ds.length ? approved / ds.length : 0;
    return {
      lang,
      people: mask(people, people),
      submitted: mask(people, submitted),
      approved: mask(people, approved),
      declined: mask(people, ds.length - approved),
      approvalRate: mask(people, round3(rate)),
      gapFromOverall: mask(Math.min(people, decidedPeople), round3(rate - overall)),
    };
  });

  const everUnclaimed = items.filter((i) => i.wasUnclaimed || i.status === 'UNCLAIMED');
  const unclaimedPeople = new Set(everUnclaimed.map((i) => person(reqById.get(i.requestId) as ReportRequestRow))).size;

  return {
    period: { from: from ?? null, to: to ?? null },
    k,
    totals: {
      inCents: mask(donors, inCents),
      donations: mask(donors, donations.length),
      donors: mask(donors, donors),
      outCents: mask(helped, outCents),
      paidPayouts: mask(helped, paid.length),
      peopleHelped: mask(helped, helped),
      inFlightCents: mask(withItems, inFlightCents),
      balanceCents: inCents - outCents - inFlightCents,
    },
    donationsBySource,
    byCategory: groupBy(paid, (_, r) => r.ruleKey ?? 'other', true),
    byLanguage: groupBy(paid, (_, r) => r.lang),
    byWallet: groupBy(paid, (i) => i.wallet),
    timeToCash: {
      samples: mask(ttcPeople, durations.length),
      p50Seconds: durations.length ? mask(ttcPeople, Math.round(percentile(durations, 0.5))) : null,
      p90Seconds: durations.length ? mask(ttcPeople, Math.round(percentile(durations, 0.9))) : null,
    },
    approvalParity: { overallRate: mask(decidedPeople, round3(overall)), rows: parityRows },
    unclaimed: {
      items: mask(withItems, items.length),
      everUnclaimed: mask(unclaimedPeople, everUnclaimed.length),
      claimedAfterHelp: mask(unclaimedPeople, everUnclaimed.filter((i) => i.status === 'SUCCESS').length),
      // Small-cell suppression: a rate over many items would still reveal 1–2 unclaimed people.
      rate: unclaimedPeople > 0 && unclaimedPeople < k
        ? MASK
        : mask(withItems, items.length ? round3(everUnclaimed.length / items.length) : 0),
    },
  };
}
