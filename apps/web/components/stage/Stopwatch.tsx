'use client';

import { useEffect, useState } from 'react';
import { cx, stopwatch } from '@/lib/format';
import type { ClockState } from './stage-steps';

export function Stopwatch({
  clock,
  skewMs,
  size = 'lg',
  caption,
}: {
  clock: ClockState;
  /** client clock minus server clock */
  skewMs: number;
  size?: 'lg' | 'sm';
  caption: { idle: string; running: string; paid: string; blocked: string };
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
  const status = clock.kind === 'idle' ? caption.idle : clock.kind === 'running' ? caption.running : paid ? caption.paid : caption.blocked;

  return (
    <div>
      <p
        role="timer"
        aria-label={`Elapsed ${text}`}
        className={cx(
          'tabular font-light leading-[0.9] tracking-[-0.045em] transition-colors duration-700',
          size === 'lg' ? 'text-[clamp(4.5rem,6.4vw,8rem)]' : 'text-[1.6rem] font-normal tracking-[-0.02em]',
          clock.kind === 'idle' && 'text-ink-3',
          clock.kind === 'running' && 'text-ink',
          paid && 'text-lamp-display',
          blocked && 'text-ink-3',
        )}
      >
        {text}
      </p>
      <p hidden={size === 'sm'} className={cx('mt-2 flex items-center gap-2 text-[0.95rem]', paid ? 'text-lamp-ink' : blocked ? 'text-signal' : 'text-ink-2')} aria-live="polite">
        <span
          aria-hidden
          className={cx(
            'inline-block size-2.5 rounded-full',
            clock.kind === 'running' && 'bg-ink animate-breathe',
            clock.kind === 'idle' && 'border border-ink-3',
            paid && 'bg-lamp',
            blocked && 'bg-signal',
          )}
        />
        {status}
      </p>
    </div>
  );
}
