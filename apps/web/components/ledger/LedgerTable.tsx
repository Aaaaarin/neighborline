'use client';

import type { PayoutItemStatus } from '@neighborline/core';
import { Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { LANGUAGE_NAMES, clockTime, cx, money, shortDate, shortId, walletLabel } from '@/lib/format';
import type { LedgerView } from '@/lib/types';

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
  const pending = view.rows.filter((r) => r.reconcile !== 'matched' && r.reconcile !== 'seeded' && r.status === 'SUCCESS').length;

  const reconcile = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.reconcile();
      setView(await api.ledger());
      setNote(`Checked ${r.checked} items against PayPal Transaction Search: ${r.matched} matched, ${r.mismatched} mismatched${r.simulated ? ' (simulated)' : ''}.`);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Reconcile didn’t run. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-y border-rule py-6 md:grid-cols-4">
        {[
          ['Landed', money(view.summary.paidCents)],
          ['Sending now', money(view.summary.pendingCents)],
          ['Unclaimed', money(view.summary.unclaimedCents)],
          ['Left in the fund', money(view.balanceCents)],
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

      <div className="mt-5 overflow-x-auto rounded-2xl border border-rule bg-raised">
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
              <tr key={r.itemId} className="border-b border-rule last:border-0 hover:bg-paper/60">
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
                      'inline-flex rounded-full px-2.5 py-0.5 text-[0.8rem] font-medium',
                      r.status === 'SUCCESS' ? 'bg-lamp-wash text-ink' : r.status === 'UNCLAIMED' || r.status === 'PENDING' ? 'border border-rule-strong text-ink' : 'bg-signal-wash text-signal',
                    )}
                  >
                    {STATUS_TEXT[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[0.8rem] leading-snug text-ink-2">
                  <span className="block">
                    batch <span className="id-text text-ink" title={r.senderBatchId}>{shortId(r.senderBatchId, 9, 4)}</span>
                  </span>
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
                    <span className="text-signal">Mismatch</span>
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
