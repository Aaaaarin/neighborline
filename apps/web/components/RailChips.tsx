import type { RailFlag, RailFlagCode } from '@neighborline/core';
import { Ban, Check, Eye } from 'lucide-react';
import { cx } from '@/lib/format';

type Tone = 'pass' | 'review' | 'block' | 'neutral';

export function Chip({ tone = 'neutral', icon, children, className, title }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.8rem] font-medium leading-tight',
        tone === 'pass' && 'bg-pine-wash text-pine',
        tone === 'review' && 'border border-rule-strong bg-sunk text-ink',
        tone === 'block' && 'bg-signal-wash text-signal',
        tone === 'neutral' && 'border border-rule bg-raised text-ink-2',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Each rail check we run, and how it reads when it passes, needs a look, or blocks. */
const CHECKS: Array<{ codes: RailFlagCode[]; pass: string; review: string; block: string }> = [
  { codes: ['LOOKALIKE_HANDLE', 'DEST_IS_GROUP_HANDLE'], pass: 'Handle checked', review: 'Handle looks unusual', block: 'Lookalike handle blocked' },
  { codes: ['DUP_DESTINATION_DIFF_NAME'], pass: 'Destination not reused', review: 'Destination used under another name', block: 'Destination blocked' },
  { codes: ['CAP_EXCEEDED', 'BUDGET_EXCEEDED'], pass: 'Within caps', review: 'Asks above the caps', block: 'Over budget' },
  { codes: ['VELOCITY'], pass: 'Normal pace', review: 'Many requests to this destination', block: 'Too many requests' },
  { codes: ['PROMPT_INJECTION'], pass: 'No hidden instructions', review: 'Instructions in message ignored', block: 'Message blocked' },
];

export function railSummary(flags: RailFlag[]) {
  return CHECKS.map((c) => {
    const hit = flags.find((f) => c.codes.includes(f.code));
    const tone: Tone = !hit ? 'pass' : hit.severity === 'block' ? 'block' : 'review';
    return { tone, label: !hit ? c.pass : hit.severity === 'block' ? c.block : c.review, detail: hit?.detail };
  });
}

export function RailChips({ flags, className, compact = false }: { flags: RailFlag[]; className?: string; compact?: boolean }) {
  const items = railSummary(flags);
  // Problems first, so they're never hidden below the fold of a small phone.
  const sorted = [...items].sort((a, b) => rank(a.tone) - rank(b.tone));
  const shown = compact ? sorted.filter((i, idx) => i.tone !== 'pass' || idx < 3) : sorted;
  const passed = items.filter((i) => i.tone === 'pass').length;
  return (
    <div className={className}>
      <ul className="flex flex-wrap gap-1.5" aria-label={`Rail protection: ${passed} of ${items.length} checks passed`}>
        {shown.map((i) => (
          <li key={i.label}>
            <Chip
              tone={i.tone}
              title={i.detail}
              icon={
                i.tone === 'pass' ? <Check size={14} strokeWidth={2.4} aria-hidden /> : i.tone === 'block' ? <Ban size={14} strokeWidth={2.2} aria-hidden /> : <Eye size={14} strokeWidth={2} aria-hidden />
              }
            >
              {i.label}
            </Chip>
          </li>
        ))}
        {compact && shown.length < items.length && (
          <li>
            <Chip tone="neutral">+{items.length - shown.length} passed</Chip>
          </li>
        )}
      </ul>
    </div>
  );
}

function rank(t: Tone) {
  return t === 'block' ? 0 : t === 'review' ? 1 : 2;
}
