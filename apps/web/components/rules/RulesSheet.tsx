'use client';

import { cx } from '@/lib/format';

/** Lowercase letters, digits and $ only: how a quoted sentence is matched back to a line of the rules. */
export const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();

/** 1-based line of `text` that contains `quote` (null when the quote is not on one line). */
export function lineOf(text: string, quote: string | null | undefined): number | null {
  if (!quote) return null;
  const q = squash(quote);
  if (!q) return null;
  const i = text.split('\n').findIndex((l) => squash(l).includes(q));
  return i >= 0 ? i + 1 : null;
}

const TYPE = 'font-display text-[1rem] leading-[1.7rem] sm:text-[1.0625rem] whitespace-pre-wrap break-words';
const PAD = 'py-4 pl-11 pr-4 sm:pl-14 sm:pr-5';

/**
 * The organizers' rules as a numbered sheet. A transparent textarea sits on a mirror of its own text
 * (same font, width and wrapping), so every line number sits beside its line even when it wraps, and
 * the line the review points at is lit behind the text. The mirror sets the height: no inner scroll.
 */
export function RulesSheet({
  value,
  onChange,
  highlight,
  cited,
  disabled,
  id,
  describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  /** line the reader is looking at in the review (1-based) */
  highlight: number | null;
  /** lines a compiled rule quotes */
  cited: Set<number>;
  disabled?: boolean;
  id: string;
  describedBy?: string;
}) {
  const lines = value.split('\n');
  return (
    <div className="relative rounded-2xl border border-rule-strong bg-raised focus-within:border-ink">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-9 rounded-l-2xl border-r border-rule bg-sunk/60 sm:w-12" />
      <div aria-hidden className={cx('pointer-events-none relative', PAD, TYPE)}>
        {lines.map((l, i) => {
          const n = i + 1;
          const lit = highlight === n;
          return (
            <div key={n} className={cx('relative -mx-2 rounded-md px-2 text-transparent transition-colors duration-150', lit && 'bg-frost')}>
              {l || ' '}
              <span className={cx('absolute right-full top-0 pr-2.5 text-right font-sans text-[0.75rem] tabular', lit ? 'font-semibold text-ink' : cited.has(n) ? 'text-ink-2' : 'text-ink-3')}>
                {n}
              </span>
            </div>
          );
        })}
        {/* the textarea needs room for a trailing newline the mirror would collapse */}
        {value.endsWith('\n') && <div>{' '}</div>}
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck
        aria-describedby={describedBy}
        className={cx('absolute inset-0 block h-full w-full resize-none overflow-hidden rounded-2xl bg-transparent text-ink caret-ink outline-none disabled:opacity-70', PAD, TYPE)}
      />
    </div>
  );
}
