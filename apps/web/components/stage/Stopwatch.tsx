'use client';

import { useEffect, useState } from 'react';
import { cx, stopwatch } from '@/lib/format';
import type { ClockState, SpeedSplit } from './stage-steps';

export function Stopwatch({
  clock,
  skewMs,
  size = 'lg',
  caption,
  splitAt,
}: {
  clock: ClockState;
  /** client clock minus server clock */
  skewMs: number;
  size?: 'lg' | 'sm';
  caption: { idle: string; running: string; paid: string; blocked: string; refused?: string };
  /** people vs system time at a given server time (large stopwatch only) */
  splitAt?: (serverNowMs: number) => SpeedSplit | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (clock.kind !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, [clock.kind]);

  const ms = clock.kind === 'running' ? now - skewMs - clock.startAt : clock.kind === 'stopped' ? clock.ms : 0;
  const text = stopwatch(ms);
  const paid = clock.kind === 'stopped' && clock.reason === 'paid';
  const blocked = clock.kind === 'stopped' && clock.reason === 'blocked';
  // PayPal refused the batch: stopped, nothing moved, in the alarm color (never the paid lamp).
  const refused = clock.kind === 'stopped' && clock.reason === 'refused';
  const split = size === 'lg' && splitAt ? splitAt(now - skewMs) : null;
  const status = clock.kind === 'idle' ? caption.idle : clock.kind === 'running' ? caption.running : paid ? caption.paid : refused ? (caption.refused ?? caption.blocked) : caption.blocked;

  return (
    <div>
      <p
        role="timer"
        aria-label={`Elapsed ${text}${refused ? ', stopped: PayPal refused the payout' : ''}`}
        data-clock={clock.kind === 'stopped' ? clock.reason : clock.kind}
        className={cx(
          'tabular font-light leading-[0.9] tracking-[-0.045em] transition-colors duration-700',
          size === 'lg' ? 'text-[clamp(4.5rem,6.4vw,8rem)]' : 'text-[1.6rem] font-normal tracking-[-0.02em]',
          clock.kind === 'idle' && 'text-ink-3',
          clock.kind === 'running' && 'text-ink',
          paid && 'text-lamp-display',
          blocked && 'text-ink-3',
          refused && 'text-signal',
        )}
      >
        {text}
      </p>
      <p hidden={size === 'sm'} className={cx('mt-2 flex items-center gap-2 text-[0.95rem]', paid ? 'text-lamp-ink' : blocked || refused ? 'text-signal' : 'text-ink-2')} aria-live="polite">
        <span
          aria-hidden
          className={cx(
            'inline-block size-2.5 rounded-full',
            clock.kind === 'running' && 'bg-ink animate-breathe',
            clock.kind === 'idle' && 'border border-ink-3',
            paid && 'bg-lamp',
            (blocked || refused) && 'bg-signal',
          )}
        />
        {status}
      </p>
      {split && split.totalMs > 0 && !blocked && !refused && <Split split={split} />}
    </div>
  );
}

/** Two segments on one track: time people spent deciding, and time the system took. */
function Split({ split }: { split: SpeedSplit }) {
  const human = Math.min(100, (split.humanMs / split.totalMs) * 100);
  return (
    <div className="mt-4 max-w-[30rem]">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-sunk" aria-hidden>
        <span className="h-full bg-frost-ink/45 transition-[width] duration-100" style={{ width: `${human}%` }} />
        <span className="h-full flex-1 bg-ink" />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-[0.88rem]">
        <div>
          <dt className="flex items-center gap-1.5 text-ink-2">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-frost-ink/45" />
            Neighbors deciding
          </dt>
          <dd className={cx('tabular text-[1.15rem] font-medium', split.humanNow ? 'text-ink' : 'text-ink-2')}>{stopwatch(split.humanMs)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-ink-2">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-ink" />
            System
          </dt>
          <dd className="tabular text-[1.15rem] font-medium text-ink">{stopwatch(split.machineMs)}</dd>
        </div>
      </dl>
    </div>
  );
}
