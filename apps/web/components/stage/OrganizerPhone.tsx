'use client';

import { useEffect, useState } from 'react';
import type { Organizer, RequestView } from '@/lib/types';
import { LANGUAGE_NAMES, cx, money } from '@/lib/format';
import { ApproveCard } from '../ApproveCard';
import { PhoneFrame } from '../PhoneFrame';

export function OrganizerPhone({
  me,
  view,
  onApprove,
  busy,
  error,
  highlight,
  label,
}: {
  me: Organizer;
  view: RequestView | null;
  onApprove?: () => void;
  busy?: boolean;
  error?: string | null;
  highlight?: boolean;
  label: string;
}) {
  const visible = view && view.request.status !== 'intake' ? view : null;
  const buzzKey = visible ? visible.request.id : 0;
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setBanner(null);
      return;
    }
    const r = visible.request;
    const blocked = r.railFlags.some((f) => f.severity === 'block');
    setBanner(
      blocked
        ? 'Blocked request · rail protection'
        : `New request · ${LANGUAGE_NAMES[r.lang].native} · ${money(r.computed?.amountCents ?? 0)}`,
    );
    const id = setTimeout(() => setBanner(null), 3800);
    return () => clearTimeout(id);
    // only when a new request lands on this phone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzzKey]);

  const waiting =
    visible && visible.request.status === 'awaiting_approval' && !visible.request.railFlags.some((f) => f.severity === 'block') && !visible.approvals.some((a) => a.organizerId === me.id) ? 1 : 0;
  return (
    <PhoneFrame label={label} battery={me.id === 'org_dana' ? 58 : 71} time="7:42" buzzKey={buzzKey}>
      <div className="relative flex shrink-0 items-center justify-between gap-2 border-b border-rule px-4 pb-2.5 pt-1">
        <div className="min-w-0">
          <p className="truncate text-[0.95rem] font-semibold leading-tight text-ink">Eastside Mutual Aid</p>
          <p className="text-[0.74rem] leading-tight text-ink-3">{waiting ? `${waiting} waiting for you` : 'Approval queue'}</p>
        </div>
        <span className="grid size-9 place-items-center rounded-full bg-frost text-[0.85rem] font-semibold text-frost-ink" aria-hidden>
          {me.name[0]}
        </span>
      </div>
      <div
        className={cx(
          'pointer-events-none absolute inset-x-2.5 top-12 z-20 rounded-2xl border border-rule bg-raised/95 px-3.5 py-2.5 shadow-lg backdrop-blur transition-all duration-300',
          banner ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0',
        )}
        aria-hidden={!banner}
      >
        <p className="flex justify-between text-[0.7rem] text-ink-3">
          <span>Neighborline</span>
          <span>now</span>
        </p>
        <p className="text-[0.86rem] font-semibold text-ink">{banner}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-3">
        {visible ? (
          <ApproveCard view={visible} me={me} onApprove={onApprove} busy={busy} error={error} dense highlight={highlight} />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="font-display text-[1.15rem] text-ink">Nobody is waiting.</p>
              <p className="mt-1 text-[0.85rem] leading-snug text-ink-3">When a neighbor confirms a request, this phone buzzes.</p>
            </div>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}
