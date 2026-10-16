'use client';

import { LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, openStream } from '@/lib/api';
import { LANGUAGE_NAMES, clockTime, cx, money, walletLabel } from '@/lib/format';
import type { DeclineReasonCode, Organizer, RequestView } from '@/lib/types';
import { ApproveCard } from '../ApproveCard';

const REASONS: Array<[DeclineReasonCode, string]> = [
  ['needs_info', 'Need more information'],
  ['household_cap', 'Household reached this month’s limit'],
  ['outside_area', 'Outside our area'],
  ['not_covered', 'Not covered by our rules'],
  ['other', 'Something else (write a note)'],
];

export function OrganizerQueue({ organizers, initial }: { organizers: Organizer[]; initial: RequestView[] }) {
  const [meId, setMeId] = useState(organizers[0]!.id);
  const me = organizers.find((o) => o.id === meId)!;
  const [items, setItems] = useState<RequestView[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<RequestView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.requests());
      setLoadError(null);
    } catch {
      setLoadError('Couldn’t refresh the queue. Showing what we had; retrying when something changes.');
    }
  }, []);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const close = openStream(() => {
      if (t) clearTimeout(t);
      t = setTimeout(load, 120);
    });
    return () => {
      close();
      if (t) clearTimeout(t);
    };
  }, [load]);

  const approve = async (v: RequestView) => {
    setBusy(v.request.id);
    setErrors((e) => ({ ...e, [v.request.id]: '' }));
    try {
      await api.approve({ requestIds: [v.request.id], organizerId: me.id, deviceLabel: me.deviceLabel });
      await load();
    } catch (err) {
      setErrors((e) => ({ ...e, [v.request.id]: err instanceof ApiError ? err.message : 'Approval didn’t go through. Try again.' }));
    } finally {
      setBusy(null);
    }
  };

  const waiting = items.filter((v) => v.request.status === 'awaiting_approval');
  const mine = waiting.filter((v) => !v.approvals.some((a) => a.organizerId === me.id) && !v.request.railFlags.some((f) => f.severity === 'block'));
  const decided = items.filter((v) => ['paying', 'paid', 'unclaimed', 'declined', 'returned', 'failed', 'cancelled'].includes(v.request.status)).slice(0, 12);

  return (
    <div className="mx-auto max-w-[560px] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.95rem] text-ink-2">Eastside Mutual Aid</p>
          <h1 className="mt-1 text-h3 text-ink">{mine.length === 0 ? 'You’re all caught up' : mine.length === 1 ? '1 request needs you' : `${mine.length} requests need you`}</h1>
        </div>
        <label className="flex flex-col gap-1 text-[0.85rem] text-ink-2">
          Approving as
          <select
            value={meId}
            onChange={(e) => setMeId(e.target.value)}
            className="h-11 rounded-full border border-rule-strong bg-raised px-4 text-[0.95rem] font-semibold text-ink"
          >
            {organizers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 max-w-[52ch] text-[0.95rem] text-ink-2">
        Every payout needs two different organizers. Amounts come from Policy v1 and can’t be edited here — if something looks wrong, decline with a reason.
      </p>
      {loadError && (
        <p role="status" className="mt-4 rounded-xl bg-sunk px-4 py-3 text-[0.9rem] text-ink-2">
          {loadError}
        </p>
      )}

      <section aria-label="Waiting for approval" className="mt-8 space-y-5">
        {waiting.length === 0 && (
          <div className="rounded-2xl border border-dashed border-rule-strong px-6 py-10 text-center">
            <p className="font-display text-[1.2rem] text-ink">Nobody is waiting right now.</p>
            <p className="mt-1 text-[0.92rem] text-ink-3">
              New requests appear here the moment a neighbor confirms. <a href="/call" className="font-semibold text-ink underline underline-offset-4">Send one yourself</a>.
            </p>
          </div>
        )}
        {waiting.map((v) => (
          <ApproveCard
            key={v.request.id}
            view={v}
            me={me}
            busy={busy === v.request.id}
            error={errors[v.request.id]}
            onApprove={() => void approve(v)}
            onDecline={() => setDeclining(v)}
          />
        ))}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="recent" className="mt-14">
          <h2 id="recent" className="text-[1.3rem] text-ink">
            Recently decided
          </h2>
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {decided.map((v) => {
              const st = v.payout?.item.status ?? v.request.status;
              return (
                <li key={v.request.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[0.95rem] text-ink">
                      {v.requester.displayName} · {v.categoryLabel} · <span lang={v.request.lang}>{LANGUAGE_NAMES[v.request.lang].native}</span>
                    </p>
                    <p className="text-[0.82rem] text-ink-3">
                      {v.payout ? `${walletLabel(v.payout.item.wallet)} · ${clockTime(v.payout.item.lastEventAt)}` : v.decline ? `Declined · ${clockTime(v.decline.at)}` : ''}
                    </p>
                  </div>
                  <span
                    className={cx(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-[0.8rem] font-medium',
                      st === 'SUCCESS' ? 'bg-lamp-wash text-ink' : st === 'declined' ? 'bg-sunk text-ink-2' : 'border border-rule-strong text-ink-2',
                    )}
                  >
                    {st === 'SUCCESS' ? `${money(v.payout!.item.amountCents)} landed` : st === 'UNCLAIMED' ? 'Unclaimed' : st === 'PENDING' ? 'Sending' : st === 'declined' ? 'Declined' : String(st)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {declining && <DeclineSheet view={declining} me={me} onClose={() => setDeclining(null)} onDone={() => void load()} />}
    </div>
  );
}

function DeclineSheet({ view, me, onClose, onDone }: { view: RequestView; me: Organizer; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<DeclineReasonCode>('needs_info');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ text: string; textEn: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lang = view.request.lang;
  const name = view.requester.displayName;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      api
        .previewDecline(view.request.id, { reasonCode: reason, note: note.trim() || undefined })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 200);
    return () => clearTimeout(id);
  }, [reason, note, view.request.id]);

  const submit = async () => {
    if (reason === 'other' && !note.trim()) {
      setError('Write a short note so the neighbor knows why.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decline(view.request.id, { organizerId: me.id, reasonCode: reason, note: note.trim() || undefined });
      onDone();
      ref.current?.close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t send the decline. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="decline-title"
      className="m-auto w-[min(560px,calc(100vw-24px))] rounded-[24px] border border-rule bg-raised p-0 text-ink backdrop:bg-[rgb(15_20_28/0.45)] max-sm:mb-0 max-sm:rounded-b-none"
    >
      <form
        method="dialog"
        className="p-5 sm:p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="decline-title" className="text-[1.5rem] leading-tight">
            Decline and tell {name} why
          </h2>
          <button type="button" onClick={() => ref.current?.close()} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-sunk" aria-label="Close">
            <X size={20} aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-[0.92rem] text-ink-2">
          {name} gets this in {LANGUAGE_NAMES[lang].en}, with a way to ask a different organizer to look again.
        </p>
        <fieldset className="mt-5">
          <legend className="text-[0.9rem] font-semibold">Reason</legend>
          <div className="mt-2 space-y-1.5">
            {REASONS.map(([code, label]) => (
              <label key={code} className={cx('flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5', reason === code ? 'border-ink bg-sunk' : 'border-rule')}>
                <input type="radio" name="reason" value={code} checked={reason === code} onChange={() => setReason(code)} className="size-4 accent-[var(--ink)]" />
                <span className="text-[0.95rem]">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 block text-[0.9rem] font-semibold" htmlFor="decline-note">
          Note to {name} <span className="font-normal text-ink-3">(optional{reason === 'other' ? ', but needed here' : ''})</span>
        </label>
        <textarea
          id="decline-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={400}
          className="mt-1.5 w-full rounded-xl border border-rule-strong bg-paper p-3 text-[0.95rem]"
          placeholder="e.g. Can you send a photo of the pharmacy receipt?"
        />
        <div className="mt-4 rounded-2xl bg-frost/60 p-4">
          <p className="text-[0.8rem] font-semibold text-frost-ink">{name} will receive</p>
          {preview ? (
            <>
              <p lang={lang} className="mt-1.5 whitespace-pre-line text-[0.95rem] leading-snug text-ink">
                {preview.text}
              </p>
              {lang !== 'en' && (
                <p lang="en" className="mt-2 border-t border-frost-ink/15 pt-2 text-[0.82rem] leading-snug text-ink-2">
                  {preview.textEn}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1.5 text-[0.9rem] text-ink-3">Preparing the message…</p>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[0.9rem] text-signal">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => ref.current?.close()} className="h-12 rounded-full border border-rule-strong px-5 font-medium">
            Keep it in the queue
          </button>
          <button type="submit" disabled={busy} className="flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-5 font-semibold text-raised disabled:opacity-60">
            {busy && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
            Decline and send to {name}
          </button>
        </div>
      </form>
    </dialog>
  );
}
