/**
 * /report: db rows → core.buildReport (aggregate-only, k-anonymous) → agents.report.write (every
 * number in the narrative traced to a fact) → ReportView. /trust: real provider and PayPal modes.
 */
import { demoModeOn } from '@neighborline/passkeys';
import { demoDisclosure } from '../security/demo-disclosure';
import { sandboxDemoReceiver } from './sandbox-standin';
import { MASK, buildReport, percentile, type Lang, type Masked, type TransparencyReport } from '@neighborline/core';
import { PayPalToolkitInflowSource, type WriteReportResult } from '@neighborline/agents';
import { getActivePolicy } from '@neighborline/db';
import { LANGUAGE_NAMES } from '../../format';
import type { GroupView, NarrativeSegment, ReportView, TrustView } from '../../types';
import { categoryLabelFor, type BaseCtx } from './context';
import { confirmedAtByRequest, manualRequestIds, signaturesByRequest } from './queries';
import { loadFund } from './totals';
import { displayNumber, hotlineNumber } from '../voice/config';

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
  // The same query and window as /ledger and /donate (totals.ts), so every page agrees.
  const [fund, policy, sigs, confirmed, byHand] = await Promise.all([loadFund(ctx), getActivePolicy(ctx.db, g.id), signaturesByRequest(ctx.db, g.id), confirmedAtByRequest(ctx.db), manualRequestIds(ctx.db)]);
  const { input, window } = fund;
  const { from, to, period } = window;
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
  // Only a real PayPal sandbox has inflows worth quoting. In fake mode the fixture inflows would
  // contradict the seeded donations on this page, so the narrative sticks to the ledger.
  const inflowSource =
    ctx.cfg.paypalMode === 'sandbox' && ctx.env.PAYPAL_CLIENT_ID && ctx.env.PAYPAL_CLIENT_SECRET
      ? new PayPalToolkitInflowSource({ clientId: ctx.env.PAYPAL_CLIENT_ID, clientSecret: ctx.env.PAYPAL_CLIENT_SECRET, sandbox: true })
      : null;
  const range = { startDate: from.toISOString().replace(/\.\d{3}Z$/, 'Z'), endDate: to.toISOString().replace(/\.\d{3}Z$/, 'Z') };
  let written: WriteReportResult;
  try {
    written = await ctx.agents.report.write({ report, groupName: g.name, categoryLabels, periodLabel: window.label, ...(inflowSource ? { inflowSource, inflowRange: range } : {}) });
  } catch {
    written = await ctx.agents.report.write({ report, groupName: g.name, categoryLabels, periodLabel: window.label });
  }
  const paragraphs = segment(written.narrative, written.numberTrace);
  const figures = paragraphs.flat().filter((s) => typeof s !== 'string').length;

  const lines = input.items
    .filter((i) => i.status === 'SUCCESS' || i.status === 'UNCLAIMED')
    .map((i) => {
      const r = reqById.get(i.requestId)!;
      return {
        date: i.successAt ?? r.createdAt,
        categoryLabel: categoryLabelFor(policy, r.ruleKey),
        amountCents: i.amountCents,
        transactionId: i.transactionId ?? '',
        status: i.status,
        ...(byHand.has(i.requestId) && i.status === 'SUCCESS' ? { rail: 'manual' as const } : {}),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    generatedAt: new Date().toISOString(),
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: window.label },
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
      note: `Any group with fewer than ${k} people is shown as “fewer than ${k}” or merged into “Other languages”, and payout lines never show language, name or neighborhood. Why ${k} and not 2 or 3: on one street, three people who asked for a heater the same week can still be recognised by their neighbors; ${k} makes that guess much harder.`,
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

/** The phone line row: true about whether this server has a Twilio number (lib/server/voice, docs/PHONE.md). */
function phoneLine(env: Record<string, string | undefined>): TrustView['sandboxReality'][number] {
  const n = hotlineNumber(env);
  return n
    ? { label: 'Phone line (call in, get a call back)', status: 'real', detail: `Live on ${displayNumber(n)}: leave a voice message in any language; the line reads it back, files it after you press 1, and calls you back in your language when the money is sent. Recordings are deleted from Twilio right after transcription.` }
    : { label: 'Phone line (call in, get a call back)', status: 'not_yet', detail: 'Phone line: built, switches on with a Twilio number. Call in, leave a voice message in any language, hear it read back, press 1 to file it, and get a call back in your language when the money is sent (docs/PHONE.md).' };
}

export function buildTrust(ctx: BaseCtx, group: GroupView, approver: ApproverStatus | null = null): TrustView {
  const sandbox = ctx.cfg.paypalMode === 'sandbox';
  const live = ctx.agents.providers.mode === 'live';
  const donorSdk = Boolean(ctx.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);
  return {
    group,
    modes: { paypalMode: ctx.cfg.paypalMode, aiMode: live ? 'live' : 'fixture', engine: 'real' },
    inThisDemo: demoDisclosure(ctx.env, ctx.cfg.paypalMode),
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
        detail: sandboxDemoReceiver(ctx.env, ctx.cfg.paypalMode)
          ? 'Venmo items are sent with recipient_wallet VENMO and social_feed_privacy PRIVATE. PayPal’s sandbox refuses any payout batch with a Venmo item, so on this server every request with a Venmo destination pays a PayPal sandbox account standing in for the neighbor’s Venmo, and every screen of the run says so.'
          : 'Venmo items are sent with recipient_wallet VENMO and social_feed_privacy PRIVATE. Whether sandbox Venmo receivers settle is unverified, so SUCCESS for Venmo is simulated.',
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
        label: 'Organizer passkeys',
        status: 'real',
        detail: demoModeOn(ctx.env)
          ? 'Every approval is a WebAuthn signature over the approval hash. Real passkeys work here; the fictional organizers’ scripted taps use server-held demo keys, labelled “demo key” on every card and in the audit log.'
          : 'Every approval is a WebAuthn signature over the approval hash, made with the organizer’s own passkey. Demo keys are switched off.',
      },
      {
        label: 'Nightly reconcile against Transaction Search',
        status: ctx.env.RENDER ? (sandbox ? 'real' : 'simulated') : 'not_yet',
        detail: ctx.env.RENDER
          ? `Scheduled on Render (Render Workflows): every night each payout item is compared with ${sandbox ? 'PayPal sandbox Transaction Search' : 'the fake PayPal’s Transaction Search'}. The ledger also has a Reconcile now button.`
          : 'Scheduled on Render when deployed there (render.yaml, Render Workflows). This server isn’t on Render, so use Reconcile now on the ledger.',
      },
      phoneLine(ctx.env),
      {
        label: 'If the sponsor’s PayPal is restricted',
        status: 'simulated',
        detail:
          'A payout PayPal refuses because of the sponsor’s account (SENDER_RESTRICTED, SENDER_LOCKED, AUTHORIZATION_ERROR and similar) is marked FAILED_RAIL: nothing was sent and organizers get an alert. If the group turned on manual recording, an organizer can record a cash or check hand-over instead; it needs the same two passkey approvals plus a receipt note, and it records only, never moving money. Tested against the local fake with PayPal’s documented error names; not yet seen from the real sandbox.',
      },
      {
        label: 'Messages back by SMS or WhatsApp',
        status: 'not_yet',
        detail: 'Texting neighbors needs carrier sender registration (A2P 10DLC or toll-free verification) and a WhatsApp Business number. Today Neighborline messages the neighbor back in their thread on the web line, in their language, and calls back neighbors who phoned in once the line is on.',
      },
      {
        label: 'Charity status confirmation',
        status: 'simulated',
        detail: 'Sandbox accounts can’t be confirmed as charities. The fiscal sponsor completes this on the live account.',
      },
    ],
  };
}
