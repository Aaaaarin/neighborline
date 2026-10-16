'use client';

import { Ban, Check, ChevronDown, Fingerprint, KeyRound, LoaderCircle, Mic, MessageCircle, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Organizer, RequestView } from '@/lib/types';
import { LANGUAGE_NAMES, clockTime, cx, money, shortId, tidyQuotes, walletLabel } from '@/lib/format';
import { dirOf } from '@/lib/i18n';
import { RailChips } from './RailChips';

const LIMIT_TEXT = {
  requested: 'what they asked for',
  category: 'the category limit',
  household: 'what’s left of the household’s monthly limit',
  daily: 'what’s left of today’s budget',
} as const;

export function ApproveCard({
  view,
  me,
  onApprove,
  onDecline,
  busy = false,
  error,
  dense = false,
  highlight = false,
  signHint,
  fallback,
}: {
  view: RequestView;
  me: Organizer;
  onApprove?: () => void;
  onDecline?: () => void;
  busy?: boolean;
  error?: string | null;
  /** inside a 360px phone on the stage */
  dense?: boolean;
  /** the visitor is meant to press this one */
  highlight?: boolean;
  /** one line under the Approve button: what will sign this tap */
  signHint?: string;
  /** the passkey prompt failed; offer the labelled demo key instead (DEMO_MODE) */
  fallback?: { reason: string; label: string; onUseDemoKey: () => void };
}) {
  const r = view.request;
  const amount = r.computed?.amountCents ?? 0;
  const lang = LANGUAGE_NAMES[r.lang];
  const block = r.railFlags.find((f) => f.severity === 'block');
  const mine = view.approvals.some((a) => a.organizerId === me.id);
  const count = view.approvals.length;
  const item = view.payout?.item;
  const dest = r.payoutDestination;
  const isVoice = r.channel === 'web_voice' || r.channel === 'phone';
  const titleId = `req-${r.id}-title`;
  const appeal = view.appeal && !view.appeal.closed && r.status === 'awaiting_approval' ? view.appeal : null;
  const declinedFirst = !!appeal && appeal.firstDecline.organizerId === me.id;

  // Keyboard and screen-reader users: after this card's Approve, focus lands on what replaced the button
  // (the confirmation, the demo-key fallback, or the error), never on <body>. "Your turn" focuses Approve.
  const pressed = useRef(false);
  const approveBtn = useRef<HTMLButtonElement>(null);
  const after = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (highlight) approveBtn.current?.focus();
  }, [highlight]);
  useEffect(() => {
    if (!pressed.current || busy) return;
    if (mine || fallback || error || item) {
      pressed.current = false;
      after.current?.focus();
    }
  }, [mine, fallback, error, item, busy]);
  const setAfter = (el: HTMLElement | null) => {
    if (el) after.current = el;
  };

  return (
    <article aria-labelledby={titleId} className={cx('rounded-2xl border border-rule bg-raised', dense ? 'p-4' : 'p-5 sm:p-6')}>
      <header className="flex items-start justify-between gap-3">
        <h3 id={titleId} className="font-sans text-[0.95rem] font-semibold tracking-normal text-ink">
          {view.requester.displayName}
          {view.requester.area && view.requester.area !== 'unknown' && <span className="font-normal text-ink-3"> · {view.requester.area}</span>}
        </h3>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-[0.78rem] text-ink-2" lang={r.lang}>
          {isVoice ? <Mic size={13} aria-hidden /> : <MessageCircle size={13} aria-hidden />}
          {lang.native}
          {view.audioSeconds ? <span className="tabular text-ink-3"> · 0:{String(view.audioSeconds).padStart(2, '0')}</span> : null}
        </span>
      </header>

      <p className={cx('mt-2 font-display text-ink', dense ? 'text-[1.06rem] leading-[1.45]' : 'text-[1.2rem] leading-[1.5]')}>
        {r.extracted?.summaryEn ?? r.englishText}
      </p>

      {view.aiTrace && !dense && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[0.78rem] text-ink-3" title="The AI output was validated against a schema before anyone saw it">
          <Check size={13} strokeWidth={2.6} className={view.aiTrace.status === 'invalid' || view.aiTrace.status === 'error' ? 'text-signal' : 'text-pine'} aria-hidden />
          {view.aiTrace.summary}
        </p>
      )}
      {view.redacted && (
        <p className="mt-1.5 text-[0.8rem] leading-snug text-ink-3">Sign in as an organizer to see the full request. Visitors see a summary, never a neighbor’s words or payout account.</p>
      )}
      {r.lang !== 'en' && r.originalText && (
        <details className="group mt-2">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-[0.85rem] text-ink-2 [&::-webkit-details-marker]:hidden">
            <ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden />
            Original in {lang.en}
          </summary>
          <p lang={r.lang} dir={dirOf(r.lang)} className="mt-1 rounded-xl bg-sunk p-3 text-[0.9rem] leading-relaxed text-ink-2">
            {r.originalText}
          </p>
        </details>
      )}

      {appeal && (
        <div className="mt-3 rounded-xl border border-frost-ink/45 bg-frost/40 p-3 text-[0.86rem] leading-snug text-ink">
          <p className="flex items-center gap-1.5 font-semibold text-frost-ink">
            <RotateCcw size={14} aria-hidden /> {view.requester.displayName} asked for another look
          </p>
          <p className="mt-1 text-ink-2">
            {appeal.firstDecline.organizerId === me.id ? 'You' : appeal.firstDecline.name} declined it at {clockTime(appeal.firstDecline.at)}: {appeal.firstDecline.reasonLabel.toLowerCase()}
            {appeal.firstDecline.note ? ` (“${appeal.firstDecline.note}”)` : ''}.
          </p>
          {appeal.text && (
            <p className="mt-1.5" lang={r.lang} dir={dirOf(r.lang)}>
              “{appeal.text}”
            </p>
          )}
          {appeal.textEn && appeal.textEn !== appeal.text && <p className="mt-0.5 text-ink-2">“{appeal.textEn}”</p>}
          <p className="mt-1.5 text-ink-2">{declinedFirst ? 'You declined it the first time, so someone else decides now.' : 'A different organizer decides this time.'}</p>
        </div>
      )}

      <div className={cx('mt-3 border-t border-rule pt-3', dense ? 'space-y-2' : 'space-y-3')}>
        <div>
          <p className={cx('font-semibold leading-none tracking-[-0.02em] text-ink', block ? 'text-ink-3 line-through decoration-2' : '', dense ? 'text-[2.1rem]' : 'text-[2.5rem]')}>
            {block ? money(r.extracted?.requestedAmountCents ?? amount) : money(amount)}
          </p>
          <p className="mt-1.5 text-[0.82rem] leading-snug text-ink-2">{r.computed?.ruleCitation ?? 'No policy category matches this request'}</p>
          {dest && (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[0.82rem] leading-snug text-ink-2">
              To {walletLabel(dest.wallet)}
              <span className={cx('id-text text-[0.9rem]', block ? 'font-bold text-signal' : 'text-ink')}>{dest.value}</span>
            </p>
          )}
        </div>
        {view.amountBreakdown && !block && (
          <details className="group">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-[0.85rem] text-ink-2 [&::-webkit-details-marker]:hidden">
              <ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden />
              Why this amount?
            </summary>
            <AmountWhy view={view} />
          </details>
        )}
        <RailChips flags={r.railFlags} compact={dense} />
        {!dense &&
          r.railFlags
            .filter((f) => f.severity === 'review')
            .map((f) => (
              <p key={f.code} className="rounded-xl border border-rule-strong bg-sunk px-3 py-2 text-[0.85rem] leading-snug text-ink-2">
                <strong className="font-semibold text-ink">Worth a look:</strong> {tidyQuotes(f.detail, r.originalText)}
              </p>
            ))}
        {block && (
          <p role="alert" className="rounded-xl bg-signal-wash p-3 text-[0.85rem] leading-snug text-signal">
            <strong className="font-semibold">Can’t approve.</strong> {block.detail}
          </p>
        )}
      </div>

      <footer className="mt-4">
        <ApprovalProgress view={view} me={me} />
        <Signatures view={view} />
        <div className="mt-3">
          {item?.status === 'SUCCESS' ? (
            <p className="flex items-center gap-2 rounded-xl bg-lamp-wash px-3 py-3 text-[0.9rem] text-ink">
              <span className="grid size-6 place-items-center rounded-full bg-lamp text-ink" aria-hidden>
                <Check size={15} strokeWidth={2.6} />
              </span>
              <span>
                <strong className="font-semibold">{money(item.amountCents)} landed</strong> in {view.requester.displayName}’s {walletLabel(item.wallet)}
                <span className="block id-text text-ink-2">tx {shortId(item.transactionId, 6, 4)}</span>
              </span>
            </p>
          ) : item?.status === 'UNCLAIMED' ? (
            <p className="rounded-xl border border-rule-strong bg-sunk px-3 py-3 text-[0.88rem] leading-snug text-ink">
              <strong className="font-semibold">Not claimed yet.</strong> {view.requester.displayName} got claim help in {lang.en}. The money waits 30 days.
            </p>
          ) : item ? (
            <p ref={setAfter} tabIndex={-1} role="status" className="flex items-center gap-2 rounded-xl bg-sunk px-3 py-3 text-[0.9rem] text-ink">
              <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
              Sending {money(item.amountCents)} through PayPal…
            </p>
          ) : r.status === 'declined' ? (
            <p className="rounded-xl bg-sunk px-3 py-3 text-[0.9rem] text-ink-2">{view.appeal?.closed ? `Declined again by a second organizer. ${view.requester.displayName} was told why, in ${lang.en}.` : `Declined. ${view.requester.displayName} was told why, in ${lang.en}, with a way to ask for another look.`}</p>
          ) : block ? (
            <button type="button" disabled className="flex h-14 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-rule bg-sunk text-[1rem] font-semibold text-ink-3">
              <Ban size={18} aria-hidden /> Approve disabled
            </button>
          ) : mine ? (
            <p ref={setAfter} tabIndex={-1} role="status" className="flex min-h-14 items-center gap-2 rounded-2xl border border-rule px-4 py-2 text-[0.92rem] text-ink-2">
              <Check size={18} className="shrink-0 text-pine" aria-hidden /> You approved. Waiting for {count < view.approvalsRequired ? 'one more organizer' : 'PayPal'}.
            </p>
          ) : (
            <button
              ref={approveBtn}
              type="button"
              onClick={() => {
                pressed.current = true;
                onApprove?.();
              }}
              disabled={busy || !onApprove}
              className={cx(
                'relative flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-[1.06rem] font-semibold text-raised transition-transform active:scale-[0.98] disabled:opacity-70',
                highlight && 'outline-3 outline-offset-3 outline-frost-ink/70 animate-breathe-outline',
              )}
            >
              {busy ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Fingerprint size={19} aria-hidden />}
              Approve {money(amount)}
            </button>
          )}
          {signHint && !item && !mine && !block && r.status === 'awaiting_approval' && !fallback && <p className="mt-1.5 text-center text-[0.78rem] leading-snug text-ink-3">{signHint}</p>}
          {fallback && !mine && !item && (
            <div role="status" className="mt-2 rounded-xl border border-dashed border-rule-strong p-3 text-[0.82rem] leading-snug text-ink-2">
              <p>{fallback.reason} This demo can sign with {fallback.label} instead. The card will say so.</p>
              <button ref={setAfter} type="button" onClick={() => { pressed.current = true; fallback.onUseDemoKey(); }} disabled={busy} className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-rule-strong px-3.5 font-medium text-ink hover:bg-sunk disabled:opacity-60">
                <KeyRound size={15} aria-hidden /> Approve with {fallback.label}
              </button>
            </div>
          )}
          {error && (
            <p ref={setAfter} tabIndex={-1} role="alert" className="mt-2 text-[0.85rem] text-signal">
              {error}
            </p>
          )}
          {onDecline && !item && r.status === 'awaiting_approval' && !block && !declinedFirst && (
            <button type="button" onClick={onDecline} className="mt-1 flex min-h-11 w-full items-center justify-center text-[0.9rem] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              Decline with a reason
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

function ApprovalProgress({ view, me }: { view: RequestView; me: Organizer }) {
  const slots = Array.from({ length: view.approvalsRequired }, (_, i) => view.approvals[i] ?? null);
  return (
    <div className="flex items-center justify-between gap-2">
      <ol className="flex items-center gap-1.5" aria-label="Approvals">
        {slots.map((a, i) => (
          <li
            key={i}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[0.8rem]',
              a ? 'bg-pine-wash text-pine' : 'border border-dashed border-rule-strong text-ink-3',
            )}
          >
            <span className={cx('grid size-6 place-items-center rounded-full text-[0.72rem] font-semibold', a ? 'bg-pine text-raised' : 'bg-sunk')} aria-hidden>
              {a ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            {a ? (a.organizerId === me.id ? 'You' : a.name) : 'Waiting'}
            {a && <span className="sr-only"> approved at {clockTime(a.at)}</span>}
          </li>
        ))}
      </ol>
      <p className="text-[0.8rem] tabular text-ink-2" aria-live="polite">
        {Math.min(view.approvals.length, view.approvalsRequired)} of {view.approvalsRequired} approvals
      </p>
    </div>
  );
}

/** "Signed with passkey · Dana’s iPhone" — what proved each approval came from that organizer. */
function Signatures({ view }: { view: RequestView }) {
  const signed = view.approvals.filter((a) => a.signer);
  if (!signed.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Approval signatures">
      {signed.map((a) => {
        const passkey = a.signer!.kind === 'passkey';
        return (
          <li
            key={a.organizerId}
            title={passkey ? `${a.name} unlocked a passkey on ${a.signer!.deviceLabel} to sign this exact payout` : `${a.name}’s demo key is held by the server. It signs the same way but no person unlocked anything.`}
            className={cx(
              'inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-[14px] px-2.5 py-1 text-[0.76rem] leading-tight',
              passkey ? 'bg-pine-wash text-pine' : 'border border-dashed border-rule-strong text-ink-2',
            )}
          >
            {passkey ? <Fingerprint size={13} className="shrink-0" aria-hidden /> : <KeyRound size={13} className="shrink-0" aria-hidden />}
            <span className="min-w-0">
              {passkey ? `Signed with passkey · ${a.signer!.deviceLabel}` : `${a.name}: signed with demo key`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AmountWhy({ view }: { view: RequestView }) {
  const b = view.amountBreakdown!;
  const rows: Array<[string, string, boolean]> = [
    ['Asked for', b.requestedCents == null ? 'Not stated' : money(b.requestedCents), b.limitedBy === 'requested'],
    [`${view.categoryLabel} limit`, money(b.categoryMaxCents), b.limitedBy === 'category'],
    ['Household, left this month', money(b.householdRemainingCents), b.limitedBy === 'household'],
    ['Group budget, left today', money(b.dailyRemainingCents), b.limitedBy === 'daily'],
  ];
  return (
    <div className="mt-1 rounded-xl bg-sunk p-3 text-[0.84rem]">
      <table className="w-full">
        <caption className="sr-only">How the amount was computed</caption>
        <tbody>
          {rows.map(([k, v, on]) => (
            <tr key={k} className={on ? 'font-semibold text-ink' : 'text-ink-2'}>
              <th scope="row" className="py-0.5 text-left font-[inherit]">
                {k}
              </th>
              <td className="py-0.5 text-right tabular">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 border-t border-rule pt-2 leading-snug text-ink-2">
        The smallest of these wins: {money(b.resultCents)}, set by {LIMIT_TEXT[b.limitedBy]}. Computed by code from Policy v{view.request.computed?.policyVersion ?? 1}, not by AI.
      </p>
    </div>
  );
}
