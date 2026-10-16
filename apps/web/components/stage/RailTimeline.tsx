'use client';

import { Ban, Check, Eye } from 'lucide-react';
import { cx, offset, shortId } from '@/lib/format';
import type { Step } from './stage-steps';

export function RailTimeline({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cx('relative', className)} aria-label="PayPal rail events">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const reached = s.state !== 'pending' && s.state !== 'active';
        return (
          <li key={s.key} data-state={s.state} className={cx('relative grid grid-cols-[28px_1fr_auto] gap-x-3', reached && 'animate-rise')}>
            {/* rail */}
            <span aria-hidden className="relative flex justify-center">
              {!last && <span className={cx('absolute top-6 bottom-0 w-[2px]', reached ? 'bg-ink/70' : 'bg-rule')} />}
              <Dot state={s.state} />
            </span>
            <div className="min-w-0 pb-3">
              <p
                className={cx(
                  'text-[0.98rem] leading-6',
                  s.state === 'money' ? 'font-semibold text-lamp-ink' : s.state === 'blocked' ? 'font-semibold text-signal' : reached ? 'font-medium text-ink' : s.state === 'active' ? 'font-medium text-ink-2' : 'text-ink-3',
                )}
              >
                {s.title}
                <span className="sr-only">{s.state === 'pending' ? ' (not yet)' : s.state === 'active' ? ' (in progress)' : ''}</span>
              </p>
              {s.detail && reached && <p className="text-[0.84rem] leading-snug text-ink-2">{s.detail}</p>}
              {s.ids && (
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.8rem]">
                  {s.ids.map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-1.5">
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="id-text text-[0.86rem] text-ink" title={v}>
                        {shortId(v, 10, 4)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <span className="pt-0.5 text-[0.8rem] tabular text-ink-3">{s.atMs !== undefined ? offset(s.atMs) : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ state }: { state: Step['state'] }) {
  const base = 'relative z-10 mt-0.5 grid size-5 place-items-center rounded-full';
  if (state === 'money') return <span className={cx(base, 'size-6 -mt-0 bg-lamp text-ink animate-glow')}><Check size={14} strokeWidth={3} /></span>;
  if (state === 'blocked') return <span className={cx(base, 'bg-signal text-raised')}><Ban size={12} strokeWidth={2.6} /></span>;
  if (state === 'warn') return <span className={cx(base, 'border-2 border-ink bg-raised text-ink')}><Eye size={11} strokeWidth={2.4} /></span>;
  if (state === 'done') return <span className={cx(base, 'bg-ink text-raised')}><Check size={12} strokeWidth={3} /></span>;
  if (state === 'active') return <span className={cx(base, 'border-2 border-ink bg-raised')}><span className="size-2 rounded-full bg-ink animate-breathe" /></span>;
  return <span className={cx(base, 'border-2 border-rule-strong bg-paper')} />;
}
