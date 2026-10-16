/**
 * Ledger, transparency report and trust view builders for the mock engine.
 * In the real system these come from packages/db queries + the ReportWriter agent.
 */
import type { Lang, PayoutItemStatus } from '@neighborline/core';
import type { GroupView, LedgerRow, LedgerView, NarrativeSegment, ReportView, TrustView } from '../types';
import { categoryLabel } from './fixtures/group';
import type { MockEngine } from './mock-engine';

const LANG_EN: Partial<Record<Lang, string>> = {
  vi: 'Vietnamese',
  es: 'Spanish',
  en: 'English',
  ht: 'Haitian Creole',
  zh: 'Chinese',
  ar: 'Arabic',
  fr: 'French',
  tl: 'Tagalog',
  ko: 'Korean',
  ru: 'Russian',
};
const K = 5;

interface Row {
  itemId: string;
  createdAt: string;
  lang: Lang;
  categoryKey: string;
  amountCents: number;
  status: PayoutItemStatus;
  transactionId?: string;
  secondsToCash: number | null;
  minutesToApproval: number | null;
  householdId: string;
  wasUnclaimed: boolean;
}

function mask(receiver: string): string {
  if (receiver.startsWith('@')) return `${receiver.slice(0, 3)}•••••`;
  if (receiver.includes('@')) return `${receiver[0]}•••@•••${receiver.slice(receiver.lastIndexOf('.'))}`;
  return `•••-•••-${receiver.slice(-4)}`;
}

function allRows(e: MockEngine): Row[] {
  const rows: Row[] = e.history.map((p) => ({ ...p, secondsToCash: p.status === 'SUCCESS' ? p.secondsToCash : null }));
  for (const item of e.items.values()) {
    const rec = e.recs.get(item.requestId);
    if (!rec) continue;
    const created = Date.parse(rec.request.createdAt);
    const firstApproval = rec.approvals[0] ? Date.parse(rec.approvals[0].at) : null;
    const secondApproval = rec.approvals[1] ? Date.parse(rec.approvals[1].at) : null;
    rows.push({
      itemId: item.id,
      createdAt: rec.request.createdAt,
      lang: rec.request.lang,
      categoryKey: rec.request.extracted?.category ?? 'other',
      amountCents: item.amountCents,
      status: item.status,
      transactionId: item.transactionId,
      secondsToCash: rec.paidAtMs ? Math.round((rec.paidAtMs - created) / 1000) : null,
      minutesToApproval: secondApproval && rec.confirmedAtMs ? (secondApproval - rec.confirmedAtMs) / 60_000 : firstApproval ? 0.5 : null,
      householdId: item.receiver,
      wasUnclaimed: rec.thread.some((m) => m.kind === 'claim_help'),
    });
  }
  return rows;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
const dur = (s: number) => {
  const r = Math.round(s);
  if (r < 60) return `${r} seconds`;
  const m = Math.floor(r / 60);
  const sec = r % 60;
  return sec ? `${m} min ${sec} s` : `${m} minutes`;
};

/** Merge languages with fewer than K households into one bucket (k-anonymity). */
function langBucket(rows: Row[]): (l: Lang) => { key: string; label: string } {
  const households = new Map<Lang, Set<string>>();
  for (const r of rows) {
    if (!households.has(r.lang)) households.set(r.lang, new Set());
    households.get(r.lang)!.add(r.householdId);
  }
  return (l) => ((households.get(l)?.size ?? 0) >= K ? { key: l, label: LANG_EN[l] ?? l } : { key: 'other', label: 'Other languages' });
}

export function buildReport(e: MockEngine): ReportView {
  const rows = allRows(e);
  const paid = rows.filter((r) => r.status === 'SUCCESS');
  const ttc = paid.map((r) => r.secondsToCash ?? 0).sort((a, b) => a - b);
  const paidCents = paid.reduce((s, r) => s + r.amountCents, 0);
  const households = new Set(paid.map((r) => r.householdId)).size;
  const languages = new Set(rows.map((r) => r.lang)).size;
  const unclaimedTotal = rows.filter((r) => r.wasUnclaimed).length;
  const unclaimedRescued = rows.filter((r) => r.wasUnclaimed && r.status === 'SUCCESS').length;
  const bucket = langBucket(rows);

  const BUCKETS: Array<[string, number, number | null]> = [
    ['Under 1 min', 0, 60],
    ['1–2 min', 60, 120],
    ['2–3 min', 120, 180],
    ['3–5 min', 180, 300],
    ['5–10 min', 300, 600],
    ['10–60 min', 600, 3600],
    ['Over 1 hour', 3600, null],
  ];
  const timeToCash = BUCKETS.map(([label, from, to]) => ({
    label,
    fromSec: from,
    toSec: to,
    count: ttc.filter((s) => s >= from && (to === null || s < to)).length,
  }));

  const byLangMap = new Map<string, { key: string; label: string; hh: Set<string>; paidCents: number }>();
  for (const r of paid) {
    const b = bucket(r.lang);
    const cur = byLangMap.get(b.key) ?? { ...b, hh: new Set<string>(), paidCents: 0 };
    cur.hh.add(r.householdId);
    cur.paidCents += r.amountCents;
    byLangMap.set(b.key, cur);
  }
  const byLanguage = [...byLangMap.values()]
    .map((v) => ({ key: v.key, label: v.label, households: v.hh.size, paidCents: v.paidCents }))
    .sort((a, b) => (a.key === 'other' ? 1 : b.key === 'other' ? -1 : b.paidCents - a.paidCents));

  const byCatMap = new Map<string, { payouts: number; paidCents: number }>();
  for (const r of paid) {
    const cur = byCatMap.get(r.categoryKey) ?? { payouts: 0, paidCents: 0 };
    cur.payouts++;
    cur.paidCents += r.amountCents;
    byCatMap.set(r.categoryKey, cur);
  }
  const byCategory = [...byCatMap.entries()]
    .map(([key, v]) => ({ key, label: categoryLabel(key), ...v }))
    .sort((a, b) => b.paidCents - a.paidCents);

  const parity = new Map<string, { label: string; mins: number[]; yes: number; total: number }>();
  for (const r of rows) {
    const b = bucket(r.lang);
    const cur = parity.get(b.key) ?? { label: b.label, mins: [], yes: 0, total: 0 };
    if (r.minutesToApproval != null) cur.mins.push(r.minutesToApproval);
    parity.set(b.key, cur);
  }
  for (const d of e.decisions) {
    const b = bucket(d.lang);
    const cur = parity.get(b.key) ?? { label: b.label, mins: [], yes: 0, total: 0 };
    cur.total++;
    if (d.approved) cur.yes++;
    parity.set(b.key, cur);
  }
  const approvalParity = [...parity.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      n: v.total,
      medianMinutesToApproval: Math.round(quantile(v.mins.sort((a, b) => a - b), 0.5) * 10) / 10,
      approvalRate: v.total ? v.yes / v.total : 1,
    }))
    .sort((a, b) => (a.key === 'other' ? 1 : b.key === 'other' ? -1 : b.n - a.n));

  const median = quantile(ttc, 0.5);
  const p90 = quantile(ttc, 0.9);
  const viEs = rows.filter((r) => r.lang === 'vi' || r.lang === 'es').length;
  const mins = approvalParity.map((p) => p.medianMinutesToApproval);
  const rates = approvalParity.map((p) => p.approvalRate * 100);
  const spread = Math.round(Math.max(...rates) - Math.min(...rates));
  const f = (figure: string, ref: string): NarrativeSegment => ({ figure, ref });
  const paragraphs: NarrativeSegment[][] = [
    [
      'In the two weeks after the October 2 ice storm, Eastside Mutual Aid sent ',
      f(usd(paidCents), 'paid'),
      ' to ',
      f(`${households} households`, 'households'),
      ' in ',
      f(`${paid.length} payouts`, 'payouts'),
      '. Half of the neighbors who asked had cash within ',
      f(dur(median), 'median'),
      ' of leaving a voice note; nine in ten within ',
      f(dur(p90), 'p90'),
      '.',
    ],
    [
      'Requests arrived in ',
      f(`${languages} languages`, 'languages'),
      '. Vietnamese and Spanish speakers made up ',
      f(`${Math.round((viEs / Math.max(1, rows.length)) * 100)}%`, 'vi-es-share'),
      ' of them — the neighbors English-only aid forms usually miss. Organizers were just as quick for every language: the median wait for a second approval ranged from ',
      f(`${Math.min(...mins)}`, 'parity-min'),
      ' to ',
      f(`${Math.max(...mins)} minutes`, 'parity-max'),
      ', and approval rates differed by at most ',
      f(`${spread} points`, 'parity-spread'),
      '.',
    ],
    [
      f(`${unclaimedTotal} payouts`, 'unclaimed'),
      ' went to a PayPal email with no account yet and came back unclaimed. The callback agent explained how to claim in the neighbor’s own language; ',
      f(`${unclaimedRescued}`, 'rescued'),
      ' were claimed. Anything still unclaimed after 30 days returns to the fund automatically.',
    ],
    [
      f(`${e.donations.donors} donors`, 'donors'),
      ' gave ',
      f(usd(e.donations.cents), 'donations'),
      '. Every figure in this report is inserted by code from the ledger and re-checked against PayPal Transaction Search. The AI wrote only the sentences around them.',
    ],
  ];
  const figuresChecked = paragraphs.flat().filter((s) => typeof s !== 'string').length;

  const lines = rows
    .filter((r) => r.status === 'SUCCESS' || r.status === 'UNCLAIMED')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({ date: r.createdAt, categoryLabel: categoryLabel(r.categoryKey), amountCents: r.amountCents, transactionId: r.transactionId ?? '', status: r.status }));

  return {
    generatedAt: new Date().toISOString(),
    period: { from: '2026-10-03', to: '2026-10-16', label: 'October 3–16, 2026' },
    narrative: { paragraphs, writtenBy: 'Report agent (fixture mode)', figuresChecked, allFiguresMatchLedger: true },
    totals: {
      paidCents,
      households,
      payouts: paid.length,
      medianSecondsToCash: Math.round(median),
      p90SecondsToCash: Math.round(p90),
      languages,
      unclaimedTotal,
      unclaimedRescued,
      donationsCents: e.donations.cents,
      donors: e.donations.donors,
    },
    timeToCash,
    byLanguage,
    byCategory,
    approvalParity,
    kAnonymity: {
      k: K,
      note: `Any language with fewer than ${K} households is merged into “Other languages”, and payout lines never show language, name or neighborhood — so no one can be picked out of this page.`,
    },
    lines,
  };
}

export function buildLedger(e: MockEngine): LedgerView {
  const rows: LedgerRow[] = e.history.map((p) => ({
    itemId: p.itemId,
    batchId: p.batchId,
    senderBatchId: p.senderBatchId,
    paypalBatchId: p.paypalBatchId,
    requestRef: p.requestRef,
    createdAt: p.createdAt,
    categoryLabel: categoryLabel(p.categoryKey),
    lang: p.lang,
    wallet: p.wallet,
    receiverMasked: p.receiverMasked,
    amountCents: p.amountCents,
    status: p.status,
    transactionId: p.transactionId,
    reconcile: e.reconciled.has(p.itemId) ? 'matched' : 'pending',
  }));
  for (const item of e.items.values()) {
    const rec = e.recs.get(item.requestId);
    const batch = e.batches.get(item.batchId);
    rows.push({
      itemId: item.id,
      batchId: item.batchId,
      senderBatchId: batch?.senderBatchId ?? '',
      paypalBatchId: batch?.paypalBatchId,
      requestRef: `NL-${item.requestId.slice(-4).toUpperCase()}`,
      createdAt: batch?.createdAt ?? item.lastEventAt,
      categoryLabel: categoryLabel(rec?.request.extracted?.category ?? 'other'),
      lang: rec?.request.lang ?? 'en',
      wallet: item.wallet,
      receiverMasked: mask(item.receiver),
      amountCents: item.amountCents,
      status: item.status,
      transactionId: item.transactionId,
      reconcile: e.reconciled.has(item.id) ? 'matched' : 'pending',
    });
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sum = (s: PayoutItemStatus) => rows.filter((r) => r.status === s).reduce((t, r) => t + r.amountCents, 0);
  const paidCents = sum('SUCCESS');
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  return {
    rows,
    // The mock (ENGINE=mock) has no window: everything it holds is "the last 30 days".
    fund: {
      window: { from: from.toISOString(), to: now.toISOString(), label: 'last 30 days', days: 30 },
      donationsInCents: e.donations.cents,
      donations: e.donations.donors,
      donors: e.donations.donors,
      landedCents: paidCents,
      landedPayouts: rows.filter((r) => r.status === 'SUCCESS').length,
      households: new Set(rows.filter((r) => r.status === 'SUCCESS').map((r) => r.requestRef)).size,
      sendingCents: sum('PENDING'),
      unclaimedCents: sum('UNCLAIMED'),
      leftInFundCents: e.donations.cents - paidCents - sum('PENDING') - sum('UNCLAIMED'),
    },
    summary: {
      paidCents,
      pendingCents: sum('PENDING'),
      unclaimedCents: sum('UNCLAIMED'),
      items: rows.length,
      batches: new Set(rows.map((r) => r.batchId)).size,
    },
    lastReconciledAt: e.lastReconciledAt,
    balanceCents: e.donations.cents - paidCents - sum('PENDING') - sum('UNCLAIMED'),
  };
}

export function buildTrust(e: MockEngine, group: GroupView): TrustView {
  const sandbox = e.modes.paypalMode === 'sandbox';
  const live = e.modes.aiMode === 'live';
  const donorSdk = Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);
  return {
    group,
    modes: e.modes,
    sandboxReality: [
      {
        label: 'Payouts to PayPal accounts',
        status: sandbox ? 'real' : 'simulated',
        detail: sandbox
          ? 'Real PayPal sandbox Payouts API calls, real batch and item ids.'
          : 'This demo runs on an in-memory stand-in for PayPal. Ids look real but are generated locally.',
      },
      {
        label: 'Payouts to Venmo',
        status: 'simulated',
        detail: 'Sandbox Venmo receivers don’t settle, so Venmo items use PayPal’s documented sandbox mock responses to reach SUCCESS.',
      },
      {
        label: 'Webhook signatures',
        status: sandbox ? 'real' : 'simulated',
        detail: 'In sandbox, every webhook is checked with verify-webhook-signature before we believe it.',
      },
      {
        label: 'Speech-to-text, translation, read-back',
        status: live ? 'real' : 'simulated',
        detail: live ? 'Live models; outputs validated against a schema before use.' : 'Fixture mode: recorded samples map to prepared transcripts so the demo runs offline.',
      },
      {
        label: 'Donations (PayPal, Venmo, Pay Later, monthly)',
        status: donorSdk ? 'real' : 'simulated',
        detail: donorSdk ? 'PayPal JS SDK Smart Buttons against the sandbox.' : 'No sandbox client id configured; the donate page shows a clearly labelled simulated button.',
      },
      {
        label: 'Callbacks by SMS and phone',
        status: 'not_yet',
        detail: 'Texting neighbors needs carrier sender registration (A2P 10DLC). Until then, callbacks appear in the web and WhatsApp-style thread.',
      },
      {
        label: 'Charity status confirmation',
        status: 'simulated',
        detail: 'Sandbox accounts can’t be confirmed as charities. The fiscal sponsor completes this on the live account.',
      },
    ],
  };
}
