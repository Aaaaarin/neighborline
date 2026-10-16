'use client';

import { AlertTriangle, ArrowRight, Check, Minus, Plus, RefreshCw } from 'lucide-react';
import { LANGUAGE_NAMES, cx, money } from '@/lib/format';
import type { PolicyCategoryDraftView, PolicyDraftView, PolicyLimitView, QueueImpactRow } from '@/lib/types';
import { lineOf } from './RulesSheet';

type Point = (line: number | null) => void;

/** "line 4" — a button that lights that line of the sheet (hover, focus or tap). */
function LineRef({ line, onPoint }: { line: number | null; onPoint: Point }) {
  if (!line) return <span className="text-[0.8rem] text-ink-3">not quoted</span>;
  return (
    <button
      type="button"
      onMouseEnter={() => onPoint(line)}
      onMouseLeave={() => onPoint(null)}
      onFocus={() => onPoint(line)}
      onBlur={() => onPoint(null)}
      onClick={() => onPoint(line)}
      className="inline-flex min-h-8 items-center rounded-full border border-rule px-2.5 text-[0.78rem] font-medium text-ink-2 tabular hover:border-ink hover:text-ink"
      aria-label={`Show line ${line} of the rules`}
    >
      line {line}
    </button>
  );
}

function Was({ cents }: { cents: number | undefined }) {
  if (cents === undefined) return null;
  return <span className="ml-1.5 text-[0.82rem] text-ink-3 line-through decoration-ink-3/60 tabular">{money(cents)}</span>;
}

function CategoryRow({ c, source, onPoint }: { c: PolicyCategoryDraftView; source: string; onPoint: Point }) {
  const line = lineOf(source, c.quote);
  const changedMax = c.before && c.before.maxCents !== c.maxCents;
  const changedHh = c.before && c.before.perHouseholdPer30dCents !== c.perHouseholdPer30dCents;
  return (
    <li className="relative flex flex-col gap-2 border-t border-rule py-3.5 first:border-t-0 sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_8rem_auto] sm:items-start sm:gap-x-4 sm:gap-y-1.5">
      {c.change !== 'same' && <span aria-hidden className="absolute -left-4 top-3.5 bottom-3.5 w-[3px] rounded-full bg-ink sm:-left-5" />}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {c.label}
            {c.change === 'added' && <span className="ml-2 rounded-full bg-frost px-2 py-0.5 align-middle text-[0.72rem] font-semibold text-frost-ink">New rule</span>}
            {c.change === 'changed' && <span className="ml-2 rounded-full border border-ink px-2 py-0.5 align-middle text-[0.72rem] font-semibold text-ink">Changed</span>}
          </p>
          <p className="text-[0.78rem] text-ink-3">
            <span className="id-text">{c.key}</span>
            {c.requiresPhoto ? ', photo required' : ''}
            {Object.keys(c.labels).length > 1 && <>, in {Object.keys(c.labels).length} languages</>}
          </p>
        </div>
        <div className="shrink-0 sm:hidden">
          <LineRef line={line} onPoint={onPoint} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 sm:contents">
        <p className="text-[0.95rem] text-ink sm:text-right">
          <span className="text-[0.78rem] text-ink-3 sm:hidden">Per request </span>
          <strong className={cx('font-semibold tabular', changedMax && 'underline decoration-2 underline-offset-4')}>{money(c.maxCents)}</strong>
          {changedMax && <Was cents={c.before?.maxCents} />}
        </p>
        <p className="text-[0.95rem] text-ink sm:text-right">
          <span className="text-[0.78rem] text-ink-3 sm:hidden">Per household in 30 days </span>
          <strong className={cx('font-semibold tabular', changedHh && 'underline decoration-2 underline-offset-4')}>{money(c.perHouseholdPer30dCents)}</strong>
          {changedHh && <Was cents={c.before?.perHouseholdPer30dCents} />}
        </p>
      </div>
      <div className="hidden sm:block">
        <LineRef line={line} onPoint={onPoint} />
      </div>
      {c.quote && <blockquote className="border-l-2 border-rule-strong pl-3 font-display text-[0.92rem] leading-snug text-ink-2 sm:col-span-full">{c.quote}</blockquote>}
    </li>
  );
}

function LimitRow({ l, source, onPoint }: { l: PolicyLimitView; source: string; onPoint: Point }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-rule py-3 first:border-t-0">
      <p className="min-w-0 text-[0.95rem] text-ink-2">{l.label}</p>
      <p className="flex items-center gap-3">
        <span className="text-ink">
          <strong className={cx('font-semibold tabular', l.before && 'underline decoration-2 underline-offset-4')}>{l.value}</strong>
          {l.before && <span className="ml-1.5 text-[0.82rem] text-ink-3 line-through">{l.before}</span>}
        </span>
        <LineRef line={lineOf(source, l.quote)} onPoint={onPoint} />
      </p>
    </li>
  );
}

const OUTCOME: Record<QueueImpactRow['outcome'], { label: string; tone: string }> = {
  same: { label: 'Same amount', tone: 'border border-rule text-ink-2' },
  more: { label: 'More', tone: 'border border-ink text-ink' },
  less: { label: 'Less', tone: 'border border-ink text-ink' },
  recategorized: { label: 'New rule applies', tone: 'bg-frost text-frost-ink' },
  blocked: { label: 'Would be held', tone: 'bg-signal-wash text-signal' },
};

export function QueuePreview({ rows, version }: { rows: QueueImpactRow[]; version: number }) {
  if (!rows.length) return <p className="text-[0.95rem] text-ink-2">Nobody is waiting for approval, so no request changes.</p>;
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {rows.map((q) => (
        <li key={q.requestId} className="py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-[0.95rem] text-ink">
              <strong className="font-semibold">{q.displayName}</strong>
              <span className="text-ink-3">, {q.categoryNow}, </span>
              <span className="text-ink-3" lang={q.lang}>
                {LANGUAGE_NAMES[q.lang].native}
              </span>
            </p>
            <p className="flex items-center gap-2 tabular">
              <span className={cx(q.outcome !== 'same' && 'text-ink-3 line-through')}>{q.currentCents === null ? '—' : money(q.currentCents)}</span>
              {q.outcome !== 'same' && (
                <>
                  <ArrowRight size={15} aria-label="becomes" className="text-ink-3" />
                  <strong className="font-semibold text-ink">{q.draftCents === null ? 'held' : money(q.draftCents)}</strong>
                </>
              )}
              <span className={cx('rounded-full px-2 py-0.5 text-[0.75rem] font-medium', OUTCOME[q.outcome].tone)}>{OUTCOME[q.outcome].label}</span>
            </p>
          </div>
          <p className="mt-1 text-[0.85rem] text-ink-2">
            {q.note}
            {q.approvalsToRedo.length > 0 && (
              <>
                {' '}
                {q.approvalsToRedo.join(' and ')} approved the v{version - 1} amount, so {q.approvalsToRedo.length === 1 ? 'that approval needs' : 'those approvals need'} to be given again under v{version}.
              </>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function traceLine(t: PolicyDraftView['trace']): string {
  const who = t.provider.startsWith('fixture') ? 'The offline parser (AI_MODE=fixture)' : `The model (${t.provider})`;
  if (t.status === 'repaired') return `${who} drafted this. Code checks failed on ${t.repairedFields.join(', ')}; one repair pass fixed ${t.repairedFields.length === 1 ? 'it' : 'them'}.`;
  if (t.status === 'locally_fixed') return `${who} drafted this. Code fixed formatting locally; the schema and quote checks then passed.`;
  return `${who} drafted this in ${t.attempts === 1 ? 'one attempt' : `${t.attempts} attempts`}. The schema check passed, every cap is a number from your text, and every quote is copied from it.`;
}

/** Step 2: what the AI drafted, checked by code, and what it would change. */
export function DraftReview({ draft, onPoint }: { draft: PolicyDraftView; onPoint: Point }) {
  const src = draft.sourceText;
  return (
    <div className="space-y-9">
      <section aria-labelledby="changes-h">
        <h3 id="changes-h" className="font-sans text-[1rem] font-semibold tracking-normal text-ink">
          What changes from v{draft.baseVersion ?? 0}
        </h3>
        <p className="mt-0.5 text-[0.82rem] text-ink-3">Computed by code by comparing the two versions, not written by the AI.</p>
        <ul className="mt-3 space-y-2">
          {draft.changes.length === 0 && <li className="text-[0.95rem] text-ink-2">Only the wording changed; every cap is the same.</li>}
          {draft.changes.map((c) => (
            <li key={c.path} className="flex items-start gap-2.5 text-[0.98rem] text-ink">
              <span className={cx('mt-1 grid size-5 shrink-0 place-items-center rounded-full', c.kind === 'removed' ? 'bg-signal-wash text-signal' : c.kind === 'added' ? 'bg-frost text-frost-ink' : 'bg-sunk text-ink')} aria-hidden>
                {c.kind === 'added' ? <Plus size={13} strokeWidth={2.6} /> : c.kind === 'removed' ? <Minus size={13} strokeWidth={2.6} /> : <RefreshCw size={11} strokeWidth={2.6} />}
              </span>
              <span>
                <span className="sr-only">{c.kind}: </span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cats-h">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="cats-h" className="font-sans text-[1rem] font-semibold tracking-normal text-ink">
            Rules as code
          </h3>
          <p className="hidden text-[0.78rem] text-ink-3 sm:block">Per request, then per household in 30 days</p>
        </div>
        <ul className="mt-2 rounded-2xl border border-rule bg-raised px-4 sm:px-5">
          {draft.categories.map((c) => (
            <CategoryRow key={c.key} c={c} source={src} onPoint={onPoint} />
          ))}
        </ul>
        {draft.removed.length > 0 && (
          <ul className="mt-2 space-y-1">
            {draft.removed.map((r) => (
              <li key={r.key} className="text-[0.9rem] text-signal">
                <Minus size={13} className="mr-1 inline" aria-hidden />
                {r.label} is removed (was up to {money(r.maxCents)} per request). Requests in it would fall under Other.
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-4 rounded-2xl border border-rule bg-raised px-4 sm:px-5" aria-label="Group-wide limits">
          {draft.limits.map((l) => (
            <LimitRow key={l.field} l={l} source={src} onPoint={onPoint} />
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-[0.82rem] text-ink-2">
          <Check size={15} strokeWidth={2.4} className="mt-0.5 shrink-0 text-pine" aria-hidden />
          {traceLine(draft.trace)}
        </p>
      </section>

      {(draft.ambiguities.length > 0 || draft.warnings.length > 0) && (
        <section aria-labelledby="check-h" className="rounded-2xl border border-rule-strong bg-sunk p-4 sm:p-5">
          <h3 id="check-h" className="flex items-center gap-2 font-sans text-[1rem] font-semibold tracking-normal text-ink">
            <AlertTriangle size={17} aria-hidden /> Check these before you sign
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.92rem] text-ink-2">
            {[...draft.ambiguities, ...draft.warnings].map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
