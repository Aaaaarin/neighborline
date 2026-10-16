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
  const declined = status === 'declined';
  const third = declined ? t.declined : itemStatus === 'UNCLAIMED' ? t.claim : t.arrived;
  const stage = declined ? 2 : status === 'awaiting_approval' ? 0 : status === 'paying' || status === 'approved' ? 1 : 2;
  const steps = [`${t.waiting} · ${approvals}/${required}`, t.sending, third];
  const warm = status === 'paid';
  return (
    <ol className="grid shrink-0 grid-cols-3 gap-1.5 px-4 py-3" aria-label="Status" lang={lang}>
      {steps.map((s, i) => {
        const done = i < stage || (i === stage && i === 2);
        const current = i === stage;
        return (
          <li key={i} aria-current={current ? 'step' : undefined}>
            <span
              className={cx(
                'block h-1.5 rounded-full',
                done && i === 2 && warm ? 'bg-lamp' : done || current ? 'bg-ink' : 'bg-rule',
                current && i !== 2 && 'animate-breathe',
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
