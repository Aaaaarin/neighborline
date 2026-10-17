/**
 * One definition of the money totals that /, /report, /ledger and /donate show (JUDGE-PANEL-2 #3c).
 *
 * Every page reads the same rows with the same query (`loadFund` → db.listForReport) over the same
 * window, and labels them the same way:
 *   - "Donations in":          completed donations received in the window.
 *   - "Landed with neighbors": payout items PayPal reports SUCCESS (or, on the manual rail, an
 *                              organizer-attested hand-over), for requests filed in the window.
 *   - "Sending now":           items PayPal still holds (PENDING, ONHOLD).
 *   - "Unclaimed":             items waiting for the neighbor to claim them (UNCLAIMED).
 *   - "Not sent":              approved, but PayPal refused the batch (FAILED_RAIL, FAILED); still owed.
 *   - "Left in the fund":      donations in − landed − sending − unclaimed − not sent (core.buildReport's
 *                              balance, which counts the not-sent items as in flight).
 * The public report masks groups smaller than k (core.buildReport); the organizer ledger shows the
 * same numbers unmasked. A test (test/consistency.test.ts) asserts the pages agree.
 */
import type { PayoutItemStatus, ReportInput } from '@neighborline/core';
import { listForReport } from '@neighborline/db';
import type { FundTotals } from '../../types';
import type { BaseCtx } from './context';
import { notSentRequestIds } from './queries';

/** The whole seeded month (28 days) plus slack; a real group would pick its reporting period. */
export const FUND_WINDOW_DAYS = 30;

export interface FundWindow {
  from: Date;
  to: Date;
  /** Passed to listForReport / core.buildReport: [from, to + 1 min) so a run that lands right now counts. */
  period: { from: string; to: string };
  /** e.g. "September 16 – October 16, 2026"; pages say "Last 30 days · <label>". */
  label: string;
}

const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
const year = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'America/Los_Angeles' });

export function fundWindow(now: Date = new Date()): FundWindow {
  const from = new Date(now.getTime() - FUND_WINDOW_DAYS * 86_400_000);
  return {
    from,
    to: now,
    period: { from: from.toISOString(), to: new Date(now.getTime() + 60_000).toISOString() },
    label: `${md(from)} – ${md(now)}, ${year(now)}`,
  };
}

const SENDING: ReadonlySet<PayoutItemStatus> = new Set<PayoutItemStatus>(['PENDING', 'ONHOLD']);

/**
 * Pure: the totals of rows already limited to one window (requests by created_at, donations by date).
 * `notSent`: requests whose PENDING item sits in a batch PayPal refused (queries.notSentRequestIds).
 */
export function fundTotals(
  input: Pick<ReportInput, 'requests' | 'items' | 'donations'>,
  window: Pick<FundWindow, 'from' | 'to' | 'label'>,
  notSent: ReadonlySet<string> = new Set(),
): FundTotals {
  const reqById = new Map(input.requests.map((r) => [r.id, r]));
  const items = input.items.filter((i) => reqById.has(i.requestId));
  const sum = (pred: (s: PayoutItemStatus) => boolean) => items.filter((i) => pred(i.status)).reduce((t, i) => t + i.amountCents, 0);
  const landed = items.filter((i) => i.status === 'SUCCESS');
  const households = new Set(landed.map((i) => reqById.get(i.requestId)!.householdKey ?? `req:${i.requestId}`)).size;
  const donationsInCents = input.donations.reduce((t, d) => t + d.amountCents, 0);
  const donors = new Set(input.donations.map((d, idx) => d.donorKey ?? `anon:${idx}`)).size;
  const landedCents = sum((s) => s === 'SUCCESS');
  const refused = (i: (typeof items)[number]) => i.status === 'PENDING' && notSent.has(i.requestId);
  const notSentCents = items.filter(refused).reduce((t, i) => t + i.amountCents, 0);
  const sendingCents = sum((s) => SENDING.has(s)) - notSentCents;
  const unclaimedCents = sum((s) => s === 'UNCLAIMED');
  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString(), label: window.label, days: FUND_WINDOW_DAYS },
    donationsInCents,
    donations: input.donations.length,
    donors,
    landedCents,
    landedPayouts: landed.length,
    households,
    sendingCents,
    unclaimedCents,
    notSentCents,
    leftInFundCents: donationsInCents - landedCents - sendingCents - unclaimedCents - notSentCents,
  };
}

/** The one query behind every total on every page. */
export async function loadFund(ctx: Pick<BaseCtx, 'db' | 'gen'>, now: Date = new Date()): Promise<{ window: FundWindow; input: ReportInput; totals: FundTotals }> {
  const window = fundWindow(now);
  const [input, notSent] = await Promise.all([listForReport(ctx.db, ctx.gen.group.id, window.period), notSentRequestIds(ctx.db)]);
  return { window, input, totals: fundTotals(input, window, notSent) };
}
