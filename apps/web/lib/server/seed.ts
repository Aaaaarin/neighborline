/**
 * Deterministic history for the ledger and the transparency report (two weeks after the storm).
 * Seeded PRNG so screenshots and tests are stable.
 */
import type { Lang, PayoutItemStatus } from '@neighborline/core';

export interface HistoryPayout {
  itemId: string;
  batchId: string;
  senderBatchId: string;
  paypalBatchId: string;
  requestRef: string;
  createdAt: string;
  lang: Lang;
  categoryKey: string;
  wallet: 'PAYPAL' | 'VENMO';
  receiverMasked: string;
  amountCents: number;
  status: PayoutItemStatus;
  transactionId: string;
  secondsToCash: number;
  minutesToApproval: number;
  householdId: string;
  wasUnclaimed: boolean;
}

export interface HistoryDecision {
  lang: Lang;
  approved: boolean;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function idFrom(rand: () => number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALNUM[Math.floor(rand() * ALNUM.length)];
  return s;
}
function hex(rand: () => number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

const LANG_MIX: Array<[Lang, number]> = [
  ['vi', 14],
  ['es', 15],
  ['en', 10],
  ['ht', 6],
  ['zh', 3],
  ['ar', 2],
];

const CAT_BY_DAY = (day: number): Array<[string, number]> =>
  day < 5
    ? [['utility_outage', 0.5], ['groceries', 0.3], ['medicine_copay', 0.12], ['transport', 0.08]]
    : [['utility_outage', 0.15], ['groceries', 0.5], ['medicine_copay', 0.2], ['transport', 0.15]];

const AMOUNTS: Record<string, number[]> = {
  utility_outage: [15_000, 15_000, 12_000, 15_000, 9_000],
  groceries: [10_000, 10_000, 8_000, 6_000, 10_000],
  medicine_copay: [6_000, 12_000, 4_500, 9_000],
  transport: [5_000, 3_000, 5_000, 4_000],
};

/** Storm hit on the 2nd; history runs Oct 3–15, 2026. */
export const HISTORY_START = Date.UTC(2026, 9, 3, 15, 0, 0);

export function buildHistory(): { payouts: HistoryPayout[]; decisions: HistoryDecision[] } {
  const rand = mulberry32(20261016);
  const langs: Lang[] = [];
  for (const [l, n] of LANG_MIX) for (let i = 0; i < n; i++) langs.push(l);
  // shuffle deterministically
  for (let i = langs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [langs[i], langs[j]] = [langs[j]!, langs[i]!];
  }

  const payouts: HistoryPayout[] = [];
  const decisions: HistoryDecision[] = [];
  let batchNo = 0;
  let batchId = '';
  let senderBatchId = '';
  let paypalBatchId = '';
  langs.forEach((lang, i) => {
    const day = Math.floor((i / langs.length) * 13);
    if (i % 3 === 0) {
      batchNo++;
      batchId = `pb_${String(batchNo).padStart(3, '0')}`;
      senderBatchId = `nl_${hex(rand, 24)}`;
      paypalBatchId = idFrom(rand, 13);
    }
    const r = rand();
    let acc = 0;
    let categoryKey = 'groceries';
    for (const [k, p] of CAT_BY_DAY(day)) {
      acc += p;
      if (r <= acc) {
        categoryKey = k;
        break;
      }
    }
    const opts = AMOUNTS[categoryKey]!;
    const amountCents = opts[Math.floor(rand() * opts.length)]!;
    const wallet = rand() < 0.55 ? 'VENMO' : 'PAYPAL';
    const wasUnclaimed = wallet === 'PAYPAL' && rand() < 0.12;
    // Log-normal-ish time to cash: median ≈ 85 s, long tail of human approvals.
    const z = (rand() + rand() + rand() - 1.5) * 1.4;
    const secondsToCash = Math.round(Math.max(36, 78 * Math.exp(z * 0.9)) + (wasUnclaimed ? 3600 * (2 + rand() * 20) : 0));
    const minutesToApproval = Math.round((0.6 + rand() * 1.6 + (rand() < 0.1 ? 4 : 0)) * 10) / 10;
    const createdAt = new Date(HISTORY_START + day * 86_400_000 + Math.floor(rand() * 10 * 3_600_000)).toISOString();
    payouts.push({
      itemId: `pi_${String(i + 1).padStart(4, '0')}`,
      batchId,
      senderBatchId,
      paypalBatchId,
      requestRef: `NL-${1001 + i}`,
      createdAt,
      lang,
      categoryKey,
      wallet,
      receiverMasked: wallet === 'VENMO' ? `@${idFrom(rand, 2).toLowerCase()}•••••` : `${idFrom(rand, 1).toLowerCase()}•••@•••.com`,
      amountCents,
      status: 'SUCCESS',
      transactionId: `${idFrom(rand, 1)}${Math.floor(rand() * 10)}${idFrom(rand, 15)}`,
      secondsToCash,
      minutesToApproval,
      householdId: `hh_${Math.floor(rand() * 40)}`,
      wasUnclaimed,
    });
    decisions.push({ lang, approved: true });
  });
  // A handful of declines spread across languages (approval-rate parity).
  for (const lang of ['vi', 'es', 'en', 'es', 'vi', 'ht'] as Lang[]) decisions.push({ lang, approved: false });
  // One payout still unclaimed — honest tail.
  const last = payouts.find((p) => p.wallet === 'PAYPAL' && !p.wasUnclaimed && p.createdAt > new Date(HISTORY_START + 11 * 86_400_000).toISOString());
  if (last) {
    last.status = 'UNCLAIMED';
    last.wasUnclaimed = true;
    last.transactionId = '';
  }
  return { payouts, decisions };
}

export const HISTORY_DONATIONS = { cents: 1_284_000, donors: 213 };
