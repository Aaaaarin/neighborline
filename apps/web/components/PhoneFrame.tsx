'use client';

import { useEffect, useRef } from 'react';
import { cx } from '@/lib/format';

/**
 * A physical phone on the desk. The only element in the product allowed a shadow.
 * `warm` turns the screen to the porch-light glow (money arrived).
 */
export function PhoneFrame({
  label,
  time = '7:42',
  battery = 64,
  offline = false,
  warm = false,
  buzzKey,
  className,
  children,
}: {
  label: string;
  time?: string;
  battery?: number;
  /** power-outage detail: no wifi */
  offline?: boolean;
  warm?: boolean;
  /** change this value to make the phone buzz once */
  buzzKey?: string | number;
  className?: string;
  children: React.ReactNode;
}) {
  const low = battery <= 25;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || buzzKey === undefined || buzzKey === 0 || buzzKey === '') return;
    el.classList.remove('animate-buzz');
    void el.offsetWidth; // restart the animation
    el.classList.add('animate-buzz');
    const done = () => el.classList.remove('animate-buzz');
    el.addEventListener('animationend', done, { once: true });
    return () => el.removeEventListener('animationend', done);
  }, [buzzKey]);
  return (
    <section
      ref={ref}
      aria-label={label}
      className={cx(
        'relative isolate flex aspect-[9/18.7] w-full flex-col rounded-[52px] bg-device p-[9px] shadow-device',
        className,
      )}
    >
      <div
        className={cx(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[43px] transition-[background-color] duration-[1200ms] ease-[var(--ease-soft)]',
          warm ? 'bg-lamp-wash' : 'bg-screen',
        )}
      >
        {/* status bar */}
        <div className="relative z-10 flex h-11 shrink-0 items-center justify-between px-7 pt-1 text-[13px] font-semibold text-ink" aria-hidden="true">
          <span className="tabular">{time}</span>
          <span className="absolute left-1/2 top-2.5 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1.5">
            <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="4.5" y="5" width="3" height="6" rx="1" />
              <rect x="9" y="2.5" width="3" height="8.5" rx="1" opacity={offline ? 0.3 : 1} />
              <rect x="13.5" y="0" width="3" height="11" rx="1" opacity={offline ? 0.3 : 1} />
            </svg>
            <span className="flex items-center gap-1">
              <span className={cx('text-[11px] tabular', low && 'text-signal')}>{battery}%</span>
              <svg width="24" height="12" viewBox="0 0 24 12">
                <rect x="0.5" y="0.5" width="20" height="11" rx="3.2" fill="none" stroke="currentColor" opacity="0.45" />
                <rect x="2" y="2" width={Math.max(2, (17 * battery) / 100)} height="8" rx="1.8" fill={low ? 'var(--signal)' : 'currentColor'} />
                <path d="M22 4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
              </svg>
            </span>
          </span>
        </div>
        {children}
        {/* home indicator */}
        <div className="pointer-events-none absolute bottom-1.5 left-1/2 h-[5px] w-[120px] -translate-x-1/2 rounded-full bg-ink/80" aria-hidden="true" />
      </div>
    </section>
  );
}
