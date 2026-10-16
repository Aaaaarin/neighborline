'use client';

import type { PayoutItemStatus } from '@neighborline/core';
import { Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { LANGUAGE_NAMES, clockTime, cx, money, shortDate, shortId, walletLabel } from '@/lib/format';
import type { LedgerView } from '@/lib/types';
import { Alerts } from '../organizer/Alerts';

const FILTERS: Array<[string, PayoutItemStatus[] | null]> = [
  ['All', null],
  ['Landed', ['SUCCESS']],
  ['Sending', ['PENDING']],
  ['Unclaimed', ['UNCLAIMED']],
  ['Other', ['RETURNED', 'FAILED', 'BLOCKED', 'CANCELED', 'ONHOLD', 'REFUNDED', 'REVERSED']],
];

const STATUS_TEXT: Partial<Record<PayoutItemStatus, string>> = {
  SUCCESS: 'Landed',
  PENDING: 'Sending',
  UNCLAIMED: 'Unclaimed',
  RETURNED: 'Returned',
  FAILED: 'Failed',
  CANCELED: 'Cancelled',
};

export function LedgerTable({ initial }: { initial: LedgerView }) {
  const [view, setView] = useState(initial);
  const [filter, setFilter] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const statuses = FILTERS[filter]![1];
  const rows = statuses ? view.rows.filter((r) => statuses.includes(r.status)) : view.rows;
  const alerted = new Set((view.alerts ?? []).flatMap((a) => a.itemIds));
  const pending = view.rows.filter((r) => r.reconcile !== 'matched' && r.reconcile !== 'seeded' && r.status === 'SUCCESS').length;

  const reconcile = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.reconcile();
      setView(await api.ledger());
      setNote(`Checked ${r.checked} items against PayPal Transaction Search: ${r.matched} matched, ${r.mismatched} mismatched${r.drift ? `, ${r.drift} with status drift or stuck pending` : ''}${r.simulated ? ' (simulated)' : ''}.`);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Reconcile didn’t run. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Alerts alerts={view.alerts} items={new Map(view.rows.map((r) => [r.itemId, { requestRef: r.requestRef, amountCents: r.amountCents }]))} className="mt-8" />
      <p className="mt-8 text-[0.88rem] text-ink-3">
        Last {view.fund.window.days} days · {view.fund.window.label} · the same rows and window as the transparency report and the donate page
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-rule py-6 md:grid-cols-5">
        {[
          ['Donations in', money(view.fund.donationsInCents)],
          ['Landed with neighbors', money(view.fund.landedCents)],
          ['Sending now', money(view.fund.sendingCents)],
          ['Unclaimed', money(view.fund.unclaimedCents)],
          ...(view.fund.notSentCents ? [['Not sent (PayPal refused)', money(view.fund.notSentCents)]] : []),
          ['Left in the fund', money(view.fund.leftInFundCents)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[0.9rem] text-ink-2">{k}</dt>
            <dd className="mt-1 text-[1.6rem] font-semibold tracking-[-0.01em] text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cx(
              'inline-flex items-center gap-2 rounded-full py-1 pl-1.5 pr-3 text-[0.88rem] font-medium',
              pending ? 'border border-rule-strong text-ink' : 'bg-pine-wash text-pine',
            )}
          >
            <span className={cx('grid size-6 place-items-center rounded-full', pending ? 'bg-sunk' : 'bg-pine text-raised')} aria-hidden>
              {pending ? <RefreshCw size={13} /> : <Check size={14} strokeWidth={3} />}
            </span>
            {pending ? `${pending} not yet reconciled` : 'Reconciled with PayPal'}
            {view.lastReconciledAt && <span className="font-normal">· last run {shortDate(view.lastReconciledAt)}, {clockTime(view.lastReconciledAt)}</span>}
          </span>
          <button
            type="button"
            onClick={() => void reconcile()}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-rule-strong px-4 text-[0.9rem] font-medium text-ink hover:bg-sunk disabled:opacity-60"
          >
            {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
            Reconcile now
          </button>
        </div>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {FILTERS.map(([label], i) => (
            <button
              key={label}
              type="button"
              aria-pressed={filter === i}
              onClick={() => setFilter(i)}
              className={cx('min-h-10 rounded-full px-3.5 text-[0.9rem]', filter === i ? 'bg-ink text-raised' : 'text-ink-2 hover:bg-sunk')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {note && (
        <p role="status" className="mt-3 text-[0.9rem] text-ink-2">
          {note}
        </p>
      )}

      <div className="mt-5 overflow-x-auto rounded-2xl border border-rule bg-raised" tabIndex={0} role="region" aria-label="Payout items, scrolls sideways on small screens">
        <table className="w-full min-w-[980px] text-[0.92rem]">
          <caption className="sr-only">Payout items</caption>
          <thead>
            <tr className="border-b border-rule text-left text-[0.82rem] text-ink-3">
              {['Date', 'Request', 'Need', 'Language', 'To', 'Amount', 'Status', 'PayPal ids', 'Reconcile'].map((h, i) => (
                <th key={h} scope="col" className={cx('px-4 py-3 font-medium', i === 5 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-ink-3">
                  Nothing with this status. Choose All to see every payout.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.itemId} id={`item-${r.itemId}`} className={cx('scroll-mt-24 border-b border-rule last:border-0 hover:bg-paper/60 target:bg-frost', alerted.has(r.itemId) && 'shadow-[inset_3px_0_0_var(--ink)]')}>
                <td className="whitespace-nowrap px-4 py-3 tabular text-ink-2">{shortDate(r.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-3 id-text text-ink">{r.requestRef}</td>
                <td className="px-4 py-3 text-ink">{r.categoryLabel}</td>
                <td className="px-4 py-3 text-ink-2" lang={r.lang}>
                  {LANGUAGE_NAMES[r.lang].native}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                  {walletLabel(r.wallet)} <span className="id-text text-ink">{r.receiverMasked}</span>
                </td>
                <td className="px-4 py-3 text-right tabular font-semibold text-ink">{money(r.amountCents)}</td>
                <td className="px-4 py-3">
                  <span
                    className={cx(
                      'inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.8rem] font-medium',
                      r.rail === 'refused'
                        ? 'bg-signal-wash text-signal'
                        : r.rail === 'manual'
                          ? 'border border-dashed border-ink text-ink'
                          : r.status === 'SUCCESS'
                            ? 'bg-lamp-wash text-ink'
                            : r.status === 'UNCLAIMED' || r.status === 'PENDING'
                              ? 'border border-rule-strong text-ink'
                              : 'bg-signal-wash text-signal',
                    )}
                  >
                    {r.rail === 'manual' ? `By hand · ${r.manual?.method ?? 'other'}` : r.rail === 'refused' ? 'Not sent' : (STATUS_TEXT[r.status] ?? r.status)}
                  </span>
                  {r.rail === 'refused' && <span className="mt-0.5 block max-w-[22ch] text-[0.78rem] leading-snug text-ink-2">PayPal refused the batch (sponsor account)</span>}
                </td>
                <td className="px-4 py-3 text-[0.8rem] leading-snug text-ink-2">
                  <span className="block">
                    batch <span className="id-text text-ink" title={r.senderBatchId}>{shortId(r.senderBatchId, 9, 4)}</span>
                  </span>
                  {r.manual && (
                    <span className="block">
                      ref <span className="id-text text-ink">{r.manual.reference}</span>
                    </span>
                  )}
                  {r.transactionId && (
                    <span className="block">
                      tx <span className="id-text text-ink" title={r.transactionId}>{shortId(r.transactionId, 6, 4)}</span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[0.85rem]">
                  {r.reconcile === 'matched' ? (
                    <span className="inline-flex items-center gap-1 text-pine">
                      <Check size={14} strokeWidth={3} aria-hidden /> Matched
                    </span>
                  ) : r.reconcile === 'mismatch' ? (
                    <span className="text-signal">
                      Mismatch
                      {r.reconcileDetail && <span className="mt-0.5 block max-w-[28ch] text-[0.8rem] leading-snug text-ink-2">{r.reconcileDetail}</span>}
                    </span>
                  ) : r.reconcile === 'manual' ? (
                    <span className="text-ink-3" title="Recorded by hand on the manual rail with a receipt note; there is no PayPal transaction to match.">
                      Not a PayPal payment
                    </span>
                  ) : r.reconcile === 'seeded' ? (
                    <span className="text-ink-3" title="Demo history from the seed script; it never went through this PayPal environment, so there is nothing to reconcile.">
                      Seed history
                    </span>
                  ) : (
                    <span className="text-ink-3">{r.status === 'SUCCESS' ? 'Next run' : 'Waiting'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.85rem] text-ink-3">
        {view.summary.items} items in {view.summary.batches} PayPal batches. Transaction Search can lag up to three hours, so new payouts show “Next run” until then.
      </p>
    </>
  );
}
