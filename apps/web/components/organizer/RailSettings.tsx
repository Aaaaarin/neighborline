'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { shortDate } from '@/lib/format';
import type { RailSettingsView } from '@/lib/types';

/**
 * Group setting for the payout rail: PayPal Payouts always comes first. With the switch on, a payout
 * PayPal refuses because of the sponsor's account (restricted, locked, not authorized) can be recorded
 * as handed over by hand instead. Any signed-in organizer can change it; the audit log records who.
 */
export function RailSettings({ initial, signedIn, onChange }: { initial: RailSettingsView; signedIn: boolean; onChange?: (r: RailSettingsView) => void }) {
  const [rail, setRail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.setManualFallback(on);
      setRail(r);
      onChange?.(r);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="group mt-6 border-t border-rule pt-5" open={!!note || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-display text-[1.3rem] text-ink">If PayPal is unavailable</span>
          <span className="block text-[0.85rem] text-ink-3">{rail.manualFallback ? 'Switch to manual recording: on' : 'Payouts wait for PayPal (manual recording off)'}</span>
        </span>
        <span className="text-[0.88rem] text-ink-2 underline underline-offset-4 group-open:hidden">Change</span>
      </summary>
      <p className="mt-3 max-w-[56ch] text-[0.9rem] text-ink-2">
        Payouts go through PayPal from the fiscal sponsor’s account. If PayPal refuses one because that account is restricted, locked or not authorized, nothing is sent and you get an alert. With manual recording on, you can then hand the money over another way (cash, a sponsor check) and record it with a receipt note. Recording never moves money, and it needs the same two passkey signatures as a PayPal payout.
      </p>
      <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-[0.95rem] text-ink">
        <input type="checkbox" role="switch" checked={rail.manualFallback} disabled={!signedIn || busy} onChange={(e) => void toggle(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden
          className="relative h-6 w-10 shrink-0 rounded-full border border-rule-strong bg-sunk transition-colors peer-checked:border-ink peer-checked:bg-ink peer-disabled:opacity-50 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink after:absolute after:left-0.5 after:top-0.5 after:size-[18px] after:rounded-full after:bg-raised after:shadow after:transition-transform peer-checked:after:translate-x-4"
        />
        If PayPal is unavailable or the account is restricted, switch to manual recording
      </label>
      {rail.updatedAt && <p className="mt-1 text-[0.82rem] text-ink-3">Last changed {shortDate(rail.updatedAt)} by {rail.updatedBy?.replace(/^org_/, '').replace(/^\w/, (c) => c.toUpperCase())}</p>}
      {!signedIn && <p className="mt-2 text-[0.88rem] text-ink-3">Sign in with a passkey to change this.</p>}
      {note && (
        <p role="alert" className="mt-2 text-[0.88rem] text-signal">
          {note}
        </p>
      )}
    </details>
  );
}
