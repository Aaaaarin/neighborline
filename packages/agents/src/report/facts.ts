/**
 * Report facts: every figure the narrative may use, pre-formatted by code. The writer may only
 * use numbers that appear here (checked after generation).
 */
import { formatUsd, type Masked, type TransparencyReport } from '@neighborline/core';
import { langName } from '../lang.js';
import { numbersIn } from '../numbers.js';
import type { InflowSummary } from './inflows.js';

export interface Fact {
  key: string;
  label: string;
  value: string;
}

const isNum = (v: Masked<number> | null | undefined): v is number => typeof v === 'number';
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const duration = (s: number): string => (s < 90 ? `${s} seconds` : `${s} seconds (about ${Math.round(s / 6) / 10} minutes)`);
const human = (key: string): string => key.replace(/_/g, ' ');

export function buildFacts(report: TransparencyReport, opts: { groupName?: string; inflows?: InflowSummary; categoryLabels?: Record<string, string> } = {}): Fact[] {
  const f: Fact[] = [];
  const add = (key: string, label: string, value: string): void => void f.push({ key, label, value });
  // Masked cells say "fewer than k" with the report's own k (core default 5).
  const count = (v: Masked<number>, unit: string): string => (isNum(v) ? `${v} ${unit}` : `fewer than ${report.k} ${unit}`);
  const money = (v: Masked<number>): string => (isNum(v) ? formatUsd(v) : `not shown (fewer than ${report.k} people)`);
  const t = report.totals;
  if (opts.groupName) add('group', 'Group', opts.groupName);
  if (report.period.from || report.period.to) add('period', 'Period', `${report.period.from?.slice(0, 10) ?? 'start'} to ${report.period.to?.slice(0, 10) ?? 'today'}`);
  add('donated', 'Donated', money(t.inCents));
  add('donations', 'Donations', count(t.donations, 'donations'));
  add('donors', 'Donors', count(t.donors, 'donors'));
  add('paid_out', 'Paid out to neighbors', money(t.outCents));
  add('payouts', 'Payouts', count(t.paidPayouts, 'payouts'));
  add('people_helped', 'Households helped', count(t.peopleHelped, 'households'));
  if (isNum(t.inFlightCents) && t.inFlightCents > 0) add('in_flight', 'Sent but not yet claimed or settled', formatUsd(t.inFlightCents));
  add('balance', 'Balance on hand', formatUsd(t.balanceCents));
  for (const row of report.byCategory) {
    add(
      `category.${row.key}`,
      `Category: ${opts.categoryLabels?.[row.key] ?? human(row.key)}`,
      isNum(row.amountCents) ? `${money(row.amountCents)} in ${count(row.payouts, 'payouts')}` : `fewer than ${report.k} payouts (amount not shown)`,
    );
  }
  const langs = report.byLanguage.map((r) => langName(r.key));
  if (langs.length) {
    add('languages', 'Languages people asked for help in', `${langs.length} languages: ${langs.join(', ')}`);
  }
  if (isNum(report.timeToCash.p50Seconds)) add('ttc_p50', 'Median time from request to cash', duration(report.timeToCash.p50Seconds));
  if (isNum(report.timeToCash.p90Seconds)) add('ttc_p90', '9 in 10 people had cash within', duration(report.timeToCash.p90Seconds));
  if (isNum(report.approvalParity.overallRate)) add('approval_rate', 'Requests approved (all languages)', pct(report.approvalParity.overallRate));
  const u = report.unclaimed;
  if (isNum(u.everUnclaimed) && u.everUnclaimed > 0) {
    add('unclaimed', 'Payments not claimed at first', `${u.everUnclaimed}; ${isNum(u.claimedAfterHelp) ? u.claimedAfterHelp : `fewer than ${report.k}`} claimed after a volunteer helped`);
  }
  // A masked count may be zero, so it is left out rather than shown as "fewer than k".
  if (opts.inflows) {
    add('paypal_inflows', 'Completed donations reported by PayPal (Agent Toolkit list_transactions)', `${formatUsd(opts.inflows.totalCents)} in ${opts.inflows.count} transactions`);
  }
  add('privacy', 'Privacy rule', `groups smaller than ${report.k} people are not shown`);
  return f;
}

/** Numbers the narrative is allowed to contain. */
export function allowedNumbers(facts: readonly Fact[]): Set<number> {
  const set = new Set<number>();
  for (const fact of facts) for (const n of numbersIn(`${fact.label} ${fact.value}`)) set.add(n);
  return set;
}
