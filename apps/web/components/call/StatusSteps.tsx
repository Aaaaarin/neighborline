'use client';

import type { Lang } from '@neighborline/core';
import { Check } from 'lucide-react';
import { cx } from '@/lib/format';
import type { ui } from '@/lib/i18n';
import type { ThreadView } from '@/lib/types';

export function StatusSteps({
  t,
  status,
  itemStatus,
  approvals,
  required,
  lang,
}: {
  t: ReturnType<typeof ui>;
  status: ThreadView['status'] | undefined;
  itemStatus: ThreadView['itemStatus'];
  approvals: number;
  required: number;
  lang: Lang;
}) {
  if (!status || status === 'intake' || status === 'needs_clarification') return null;
  // A declined request never reached "Sending the money": show only what happened (organizers
  // looked at it → not this time), never a ticked payment step (JUDGE-PANEL-2 #3d). After an appeal
  // the request is back in the queue (awaiting_approval) and the normal three steps return.
  const declined = status === 'declined';
  const steps = declined
    ? [t.waiting, t.declined]
    : [`${t.waiting} · ${approvals}/${required}`, t.sending, itemStatus === 'UNCLAIMED' ? t.claim : t.arrived];
  const last = steps.length - 1;
  const stage = declined ? last : status === 'awaiting_approval' ? 0 : status === 'paying' || status === 'approved' ? 1 : 2;
  const warm = status === 'paid';
  return (
    <ol className={cx('grid shrink-0 gap-1.5 px-4 py-3', declined ? 'grid-cols-2' : 'grid-cols-3')} aria-label="Status" lang={lang}>
      {steps.map((s, i) => {
        const done = i < stage || (i === stage && i === last);
        const current = i === stage;
        return (
          <li key={i} aria-current={current ? 'step' : undefined}>
            <span
              className={cx(
                'block h-1.5 rounded-full',
                done && i === last && warm ? 'bg-lamp' : done || current ? 'bg-ink' : 'bg-rule',
                current && i !== last && 'animate-breathe',
              )}
            />
            <span className={cx('mt-1.5 flex items-start gap-1 text-[0.72rem] leading-tight', current ? 'font-semibold text-ink' : 'text-ink-3')}>
              {done && <Check size={12} className="mt-px shrink-0" aria-hidden />}
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
