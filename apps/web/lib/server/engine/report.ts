/**
 * /report: db rows → core.buildReport (aggregate-only, k-anonymous) → agents.report.write (every
 * number in the narrative traced to a fact) → ReportView. /trust: real provider and PayPal modes.
 */
import { MASK, buildReport, percentile, type Lang, type Masked, type TransparencyReport } from '@neighborline/core';
import { FixtureInflowSource, PayPalToolkitInflowSource, type WriteReportResult } from '@neighborline/agents';
import { getActivePolicy, listForReport } from '@neighborline/db';
import { LANGUAGE_NAMES } from '../../format';
import type { GroupView, NarrativeSegment, ReportView, TrustView } from '../../types';
import { categoryLabelFor, type BaseCtx } from './context';
import { confirmedAtByRequest, signaturesByRequest } from './queries';

const num = (m: Masked<number> | null | undefined): number => (typeof m === 'number' ? m : 0);
const langLabel = (l: string) => LANGUAGE_NAMES[l as Lang]?.en ?? l;
const BUCKETS: Array<[string, number, number | null]> = [
  ['Under 1 min', 0, 60],
  ['1–2 min', 60, 120],
  ['2–3 min', 120, 180],
  ['3–5 min', 180, 300],
  ['5–10 min', 300, 600],
  ['10–60 min', 600, 3600],
  ['Over 1 hour', 3600, null],
];

function periodLabel(from: Date, to: Date): string {
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
  return `${md(from)} – ${md(to)}, ${to.getFullYear()}`;
}

/** Split the narrative into paragraphs and mark every traced number as a checked figure. */
export function segment(text: string, trace: WriteReportResult['numberTrace']): NarrativeSegment[][] {
  const traced = trace.filter((t) => t.factKey !== '(ungrounded)').sort((a, b) => b.number.length - a.number.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = traced.length ? new RegExp(`(${traced.map((t) => esc(t.number)).join('|')})`, 'g') : null;
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => {
    if (!re) return [p];
    const out: NarrativeSegment[] = [];
    let last = 0;
    for (const m of p.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > last) out.push(p.slice(last, i));
      out.push({ figure: m[0], ref: traced.find((t) => t.number === m[0])?.factKey ?? 'fact' });
      last = i + m[0].length;
    }
    if (last < p.length) out.push(p.slice(last));
    return out;
  });
}

export async function buildReportView(ctx: BaseCtx): Promise<ReportView> {
  const g = ctx.gen.group;
  const to = new Date();
  const from = new Date(to.getTime() - 28 * 86_400_000);
  const period = { from: from.toISOString(), to: new Date(to.getTime() + 60_000).toISOString() };
  const [input, policy, sigs, confirmed] = await Promise.all([listForReport(ctx.db, g.id, period), getActivePolicy(ctx.db, g.id), signaturesByRequest(ctx.db, g.id), confirmedAtByRequest(ctx.db)]);
  const report: TransparencyReport = buildReport({ ...input, period });
  const k = report.k;
  const reqById = new Map(input.requests.map((r) => [r.id, r]));

  // Time to cash, from the raw rows (counts of payouts per bucket; no people dimension).
  const ttc: number[] = [];
  for (const it of input.items) {
    const r = reqById.get(it.requestId);
    if (it.status === 'SUCCESS' && it.successAt && r) ttc.push(Math.max(0, Math.round((Date.parse(it.successAt) - Date.parse(r.createdAt)) / 1000)));
  }
  const timeToCash = BUCKETS.map(([label, fromSec, toSec]) => ({ label, fromSec, toSec, count: ttc.filter((s) => s >= fromSec && (toSec === null || s < toSec)).length }));

  // Language and category rows straight from core; masked (<k people) rows merge into "Other" only if the merge itself reaches k.
  const paidByLang = new Map<string, { hh: Set<string>; cents: number }>();
  for (const it of input.items) {
    const r = reqById.get(it.requestId);
    if (!r || it.status !== 'SUCCESS') continue;
    const cur = paidByLang.get(r.lang) ?? { hh: new Set<string>(), cents: 0 };
    cur.hh.add(r.householdKey ?? r.id);
    cur.cents += it.amountCents;
    paidByLang.set(r.lang, cur);
  }
  const byLanguage = report.byLanguage.filter((r) => r.people !== MASK).map((r) => ({ key: r.key, label: langLabel(r.key), households: num(r.people), paidCents: num(r.amountCents) }));
  const maskedLangs = report.byLanguage.filter((r) => r.people === MASK).map((r) => r.key);
  const otherHh = new Set(maskedLangs.flatMap((l) => [...(paidByLang.get(l)?.hh ?? [])]));
  if (otherHh.size >= k) byLanguage.push({ key: 'other', label: 'Other languages', households: otherHh.size, paidCents: maskedLangs.reduce((s, l) => s + (paidByLang.get(l)?.cents ?? 0), 0) });
  byLanguage.sort((a, b) => (a.key === 'other' ? 1 : b.key === 'other' ? -1 : b.paidCents - a.paidCents));

  const byCategory = report.byCategory
    .filter((r) => r.people !== MASK)
    .map((r) => ({ key: r.key, label: categoryLabelFor(policy, r.key), payouts: num(r.payouts), paidCents: num(r.amountCents) }))
    .sort((a, b) => b.paidCents - a.paidCents);

  // Approval parity: core's approval rates + median minutes from confirmation to the second signature.
  const minutesByLang = new Map<string, number[]>();
  for (const r of input.requests) {
    const s = sigs.get(r.id);
    const c = confirmed.get(r.id);
    if (!s || s.length < 2 || !c) continue;
    minutesByLang.set(r.lang, [...(minutesByLang.get(r.lang) ?? []), Math.max(0, (s[1]!.getTime() - c.getTime()) / 60_000)]);
  }
  const median = (xs: number[]) => (xs.length ? Math.round(percentile(xs, 0.5) * 10) / 10 : 0);
  const approvalParity = report.approvalParity.rows
    .filter((r) => r.submitted !== MASK)
    .map((r) => ({ key: r.lang, label: langLabel(r.lang), n: num(r.submitted), medianMinutesToApproval: median(minutesByLang.get(r.lang) ?? []), approvalRate: num(r.approvalRate) }))
    .sort((a, b) => b.n - a.n);

  const categoryLabels = Object.fromEntries((policy?.categories ?? []).map((c) => [c.key, c.label.en ?? c.key]));
  const inflowSource =
    ctx.cfg.paypalMode === 'sandbox' && ctx.env.PAYPAL_CLIENT_ID && ctx.env.PAYPAL_CLIENT_SECRET
      ? new PayPalToolkitInflowSource({ clientId: ctx.env.PAYPAL_CLIENT_ID, clientSecret: ctx.env.PAYPAL_CLIENT_SECRET, sandbox: true })
      : new FixtureInflowSource();
  const range = { startDate: from.toISOString().replace(/\.\d{3}Z$/, 'Z'), endDate: to.toISOString().replace(/\.\d{3}Z$/, 'Z') };
  let written: WriteReportResult;
  try {
    written = await ctx.agents.report.write({ report, groupName: g.name, categoryLabels, inflowSource, inflowRange: range });
  } catch {
    written = await ctx.agents.report.write({ report, groupName: g.name, categoryLabels });
  }
  const paragraphs = segment(written.narrative, written.numberTrace);
  const figures = paragraphs.flat().filter((s) => typeof s !== 'string').length;

  const lines = input.items
    .filter((i) => i.status === 'SUCCESS' || i.status === 'UNCLAIMED')
    .map((i) => {
      const r = reqById.get(i.requestId)!;
      return { date: i.successAt ?? r.createdAt, categoryLabel: categoryLabelFor(policy, r.ruleKey), amountCents: i.amountCents, transactionId: i.transactionId ?? '', status: i.status };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    generatedAt: new Date().toISOString(),
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: periodLabel(from, to) },
    narrative: {
      paragraphs,
      writtenBy: written.source === 'llm' ? `Report agent (${written.trace.provider})` : `Report agent (checked template, ${ctx.agents.providers.mode} mode)`,
      figuresChecked: figures,
      allFiguresMatchLedger: written.numberTrace.every((t) => t.factKey !== '(ungrounded)'),
    },
    totals: {
      paidCents: num(report.totals.outCents),
      households: num(report.totals.peopleHelped),
      payouts: num(report.totals.paidPayouts),
      medianSecondsToCash: num(report.timeToCash.p50Seconds),
      p90SecondsToCash: num(report.timeToCash.p90Seconds),
      languages: new Set(input.requests.map((r) => r.lang)).size,
      unclaimedTotal: num(report.unclaimed.everUnclaimed),
      unclaimedRescued: num(report.unclaimed.claimedAfterHelp),
      ...(report.unclaimed.everUnclaimed === MASK ? { unclaimedMasked: true } : {}),
      donationsCents: num(report.totals.inCents),
      donors: num(report.totals.donors),
    },
    timeToCash,
    byLanguage,
    byCategory,
    approvalParity,
    kAnonymity: {
      k,
      note: `Any group with fewer than ${k} people is shown as “fewer than ${k}” or merged into “Other languages”, and payout lines never show language, name or neighborhood — so no one can be picked out of this page.`,
    },
    lines,
  };
}

/** What the approver process reports about itself (GET /v1/health; null = unreachable). */
export interface ApproverStatus {
  credentials: 'fake' | 'dedicated' | 'shared-fallback';
  requirePasskeys: boolean;
}

function leastPrivilegeLine(a: ApproverStatus | null): TrustView['sandboxReality'][number] {
  const base =
    'Only the approver — a separate process (apps/approver) — holds PayPal Payouts credentials. This web server has no Payouts client (a test fails the build otherwise); it can only ask the approver to look at an approval record. The approver re-reads the requests, recomputes the approval hash and every amount from the policy, requires two distinct organizers and re-verifies their signatures before it pays.';
  if (!a) return { label: 'Least privilege for money movement', status: 'not_yet', detail: `${base} The approver is not reachable right now, so nothing can be paid.` };
  const creds =
    a.credentials === 'dedicated'
      ? ' It uses its own PayPal REST app, separate from the one this server uses for donations and reporting.'
      : a.credentials === 'fake'
        ? ' In this mode it talks to the local fake PayPal.'
        : ' Warning: it is using the main PayPal app’s keys (local fallback), so the separation is not enforced at PayPal.';
  const keys = a.requirePasskeys ? ' Every approver must have signed with a passkey.' : '';
  return { label: 'Least privilege for money movement', status: a.credentials === 'shared-fallback' ? 'simulated' : 'real', detail: base + creds + keys };
}

export function buildTrust(ctx: BaseCtx, group: GroupView, approver: ApproverStatus | null = null): TrustView {
  const sandbox = ctx.cfg.paypalMode === 'sandbox';
  const live = ctx.agents.providers.mode === 'live';
  const donorSdk = Boolean(ctx.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);
  return {
    group,
    modes: { paypalMode: ctx.cfg.paypalMode, aiMode: live ? 'live' : 'fixture', engine: 'real' },
    sandboxReality: [
      {
        label: 'Payouts to PayPal accounts',
        status: sandbox ? 'real' : 'simulated',
        detail: sandbox
          ? 'Real PayPal sandbox Payouts API calls: real sender_batch_id, payout_batch_id and payout_item_id.'
          : 'Runs against a local fake PayPal (tools/fake-paypal) that speaks the same REST API and signs webhooks the way PayPal does. Ids look real but are generated locally.',
      },
      {
        label: 'Payouts to Venmo',
        status: 'simulated',
        detail: 'Venmo items are sent with recipient_wallet VENMO and social_feed_privacy PRIVATE. Whether sandbox Venmo receivers settle is unverified, so SUCCESS for Venmo is simulated.',
      },
      {
        label: 'Webhook signatures',
        status: sandbox ? 'real' : 'simulated',
        detail: sandbox
          ? 'Every webhook is checked with verify-webhook-signature before we believe it. (Simulator events cannot be verified, by PayPal design.)'
          : 'The fake signs PayPal’s transmission string; we verify it through the same verify-webhook-signature call, and drop duplicates by event id.',
      },
      leastPrivilegeLine(approver),
      {
        label: 'Speech-to-text, translation, read-back',
        status: live ? 'real' : 'simulated',
        detail: ctx.agents.providers.notes.join(' '),
      },
      {
        label: 'Donations (PayPal, Venmo, Pay Later, monthly)',
        status: donorSdk && sandbox ? 'real' : 'simulated',
        detail: donorSdk
          ? 'PayPal JS SDK Smart Buttons; orders are created and captured on our server.'
          : `No sandbox client id configured; the simulated button still creates and captures an Orders v2 order on the ${sandbox ? 'sandbox' : 'local fake PayPal'}.`,
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
