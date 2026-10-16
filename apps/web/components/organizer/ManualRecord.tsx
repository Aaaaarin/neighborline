'use client';

import { LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cx } from '@/lib/format';
import type { ManualPayoutResult, OrganizerAlert } from '@/lib/types';

const METHODS: Array<['cash' | 'check' | 'other', string]> = [
  ['cash', 'Cash'],
  ['check', 'A check from the sponsor'],
  ['other', 'Another way'],
];

/**
 * The manual rail, from a "PayPal refused a payout" alert: an organizer records how the neighbor got the
 * money instead. It records only; nothing here moves money. The approver accepts it only for a batch
 * PayPal refused at the account level, only when the group turned manual recording on, and only after
 * re-verifying the two passkey signatures already on this payout.
 */
export function ManualRecord({ alert, enabled, signedIn, onRecorded }: { alert: OrganizerAlert; enabled: boolean; signedIn: boolean; onRecorded: (r: ManualPayoutResult) => void }) {
  const id = useId();
  const [method, setMethod] = useState<'cash' | 'check' | 'other'>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!alert.batchId) return null;
  if (!enabled) return <p className="mt-2 text-[0.85rem] text-ink-2">Manual recording is off for this group. An organizer can turn it on under “If PayPal is unavailable” below.</p>;
  if (!signedIn) return <p className="mt-2 text-[0.85rem] text-ink-2">Sign in with your passkey to record how the money was handed over.</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onRecorded(await api.recordManual(alert.batchId!, { method, receiptNote: note.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 rounded-xl border border-rule bg-sunk/60 p-3">
      <fieldset>
        <legend className="text-[0.88rem] font-semibold text-ink">How did the neighbor get the money?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {METHODS.map(([k, label]) => (
            <label
              key={k}
              className={cx(
                'flex min-h-10 cursor-pointer items-center rounded-full border px-3 text-[0.88rem] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ink',
                method === k ? 'border-ink bg-ink text-raised' : 'border-rule-strong text-ink',
              )}
            >
              <input type="radio" name={`${id}-method`} value={k} checked={method === k} onChange={() => setMethod(k)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${id}-note`} className="mt-3 block text-[0.88rem] font-semibold text-ink">
        Receipt note
      </label>
      <textarea
        id={`${id}-note`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        required
        minLength={8}
        maxLength={500}
        rows={2}
        placeholder="Who handed it over, where and when; the check number if any"
        className="mt-1 w-full rounded-lg border border-rule-strong bg-raised px-3 py-2 text-[0.92rem] text-ink"
      />
      <p className="mt-1 text-[0.8rem] leading-snug text-ink-3">
        This records only: no money moves through PayPal or Neighborline. The approval service re-checks both organizers’ passkey signatures on this payout before it records anything.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[0.85rem] text-signal">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || note.trim().length < 8} className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[0.9rem] font-semibold text-raised disabled:opacity-60">
        {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
        Record manual payment
      </button>
    </form>
  );
}
