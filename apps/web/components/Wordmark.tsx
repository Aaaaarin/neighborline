import { cx } from '@/lib/format';

/** A phone line that ends in a porch light. The light is unlit until `lit` (money arrived). */
export function Wordmark({ lit = false, className, size = 'md' }: { lit?: boolean; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-h4' : size === 'sm' ? 'text-[1.05rem]' : 'text-[1.3rem]';
  return (
    <span className={cx('inline-flex items-center gap-2.5 text-ink', className)}>
      <svg width={size === 'lg' ? 40 : 30} height="14" viewBox="0 0 30 14" aria-hidden="true" className="shrink-0">
        <path d="M1 7h17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle
          cx="24"
          cy="7"
          r="4.5"
          fill={lit ? 'var(--lamp)' : 'none'}
          stroke={lit ? 'var(--lamp)' : 'currentColor'}
          strokeWidth="2"
          style={{ transition: 'fill .6s var(--ease-soft), stroke .6s var(--ease-soft)' }}
        />
      </svg>
      <span className={cx('font-display font-[620] tracking-[-0.015em]', text)}>Neighborline</span>
    </span>
  );
}
