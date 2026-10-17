'use client';

import { Check, LoaderCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cx, shortDate } from '@/lib/format';
import { rulesEditedSince } from '@/lib/rules-text';
import type { Organizer, OrganizerSession, PolicyDraftView, PolicyEditorView, PolicySignResult } from '@/lib/types';
import { DraftReview, QueuePreview } from './DraftReview';
import { RulesSheet, lineOf } from './RulesSheet';
import { SignPanel } from './SignPanel';

function Step({ n, title, sub, children, id }: { n: number; title: string; sub?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-baseline gap-3">
        <span aria-hidden className="grid size-8 shrink-0 translate-y-[-2px] place-items-center rounded-full border border-ink text-[0.85rem] font-semibold text-ink tabular">
          {n}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-[1.6rem] leading-tight text-ink">
            {title}
          </h2>
          {sub && <p className="mt-1 max-w-[62ch] text-[0.95rem] text-ink-2">{sub}</p>}
        </div>
      </div>
      <div className="mt-5 sm:pl-11">{children}</div>
    </section>
  );
}

export function RulesEditor({ initial, session, organizers }: { initial: PolicyEditorView; session: OrganizerSession | null; organizers: Organizer[] }) {
  const [view, setView] = useState(initial);
  const openDraft = view.draft?.status === 'open' ? view.draft : null;
  const [text, setText] = useState(openDraft?.sourceText ?? view.active.sourceText);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [activated, setActivated] = useState<PolicySignResult['activated']>(null);
  const [point, setPoint] = useState<number | null>(null);

  const draft: PolicyDraftView | null = view.draft && (view.draft.status === 'open' || activated) ? view.draft : null;
  const edited = !!draft && draft.status === 'open' && rulesEditedSince(text, draft.sourceText);
  const cited = useMemo(() => {
    const s = new Set<number>();
    if (!draft || edited) return s;
    for (const c of draft.categories) {
      const l = lineOf(text, c.quote);
      if (l) s.add(l);
    }
    for (const l of draft.limits) {
      const n = lineOf(text, l.quote);
      if (n) s.add(n);
    }
    return s;
  }, [draft, edited, text]);

  const compile = async () => {
    setBusy(true);
    setProblems(null);
    setActivated(null);
    try {
      const r = await api.draftPolicy(text);
      if (r.ok) {
        setView((v) => ({ ...v, draft: r.draft }));
        // Show exactly what will be signed (the title now says the version it becomes, e.g. "(v2)").
        setText(r.draft.sourceText);
      }
      else setProblems(r.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)));
    } catch (err) {
      setProblems([err instanceof ApiError ? err.message : 'Couldn’t draft the rules. Try again.']);
    } finally {
      setBusy(false);
    }
  };

  const onSigned = async (r: PolicySignResult) => {
    setView((v) => ({ ...v, draft: r.draft }));
    if (!r.activated) return;
    setActivated(r.activated);
    setText(r.draft.sourceText);
    const fresh = await api.policy().catch(() => null);
    if (fresh) setView({ ...fresh, draft: r.draft });
  };

  const active = view.active;
  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-20 pt-8 sm:px-8 sm:pt-10">
      <header className="max-w-[68ch]">
        <p className="text-[0.95rem] text-ink-2">
          <Link href="/organizer" className="underline underline-offset-4 hover:text-ink">
            {view.groupName}
          </Link>
        </p>
        <h1 className="mt-1 text-h3 text-ink sm:text-h2">The group’s rules</h1>
        <p className="mt-3 text-[1.02rem] text-ink-2">
          Write the rules the way you’d explain them to a new volunteer. The AI drafts them as code and shows where every number came from. Nothing changes until two of you sign the draft.
        </p>
        <p className="mt-3 inline-flex items-start gap-2 rounded-2xl bg-pine-wash px-3.5 py-1.5 text-[0.88rem] text-pine">
          <Check size={15} strokeWidth={2.6} className="mt-[3px] shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Policy v{active.version}</strong> is active
            {active.approvedBy.length ? `, approved by ${active.approvedBy.join(' and ')}` : ''}
          </span>
        </p>
      </header>

      {activated && (
        <div role="status" className="mt-8 rounded-2xl border border-pine bg-pine-wash p-5 text-pine sm:p-6">
          <p className="font-display text-[1.45rem] leading-tight">Policy v{activated.version} is now active.</p>
          <p className="mt-1.5 text-[0.95rem] text-ink-2">
            {draft?.signatures
              .filter((s) => s.counts)
              .map((s) => s.name)
              .join(' and ')}{' '}
            signed it. New requests are priced under v{activated.version}.{' '}
            {activated.repriced === 1 ? 'The request waiting for approval was re-priced by code and needs approving again.' : activated.repriced === 2 ? 'Both requests waiting for approval were re-priced by code and need approving again.' : activated.repriced > 2 ? `All ${activated.repriced} requests waiting for approval were re-priced by code and need approving again.` : ''}
          </p>
          <Link href="/organizer" className="mt-3 inline-flex h-11 items-center rounded-full bg-ink px-5 font-semibold text-raised">
            Open the approval queue
          </Link>
        </div>
      )}

      <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Step n={1} id="step-write" title="Write the rules" sub="One rule per line. Say what it covers, the most per request, and the most per household in 30 days.">
            <label htmlFor="rules-text" className="sr-only">
              The group’s rules in plain English
            </label>
            <RulesSheet id="rules-text" value={text} onChange={setText} highlight={edited ? null : point} cited={cited} disabled={busy} describedBy="rules-help" />
            <p id="rules-help" className="mt-2 text-[0.82rem] text-ink-3">
              {view.aiMode === 'fixture' ? 'Offline demo: an offline parser stands in for the AI, so keep to the “Name: up to $X per request, $Y per household in 30 days.” pattern.' : 'Any wording works; the AI may only use numbers you wrote.'}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void compile()}
                disabled={busy}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-raised active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Sparkles size={18} aria-hidden />}
                {draft && draft.status === 'open' ? 'Draft again' : 'Draft policy'}
              </button>
              {text !== active.sourceText && !busy && (
                <button type="button" onClick={() => setText(active.sourceText)} className="min-h-11 px-2 text-[0.92rem] text-ink-2 underline underline-offset-4 hover:text-ink">
                  Start over from v{active.version}
                </button>
              )}
            </div>
            {problems && (
              <div role="alert" className="mt-4 rounded-2xl bg-signal-wash p-4 text-[0.92rem] text-signal">
                <p className="font-semibold">The draft didn’t pass the checks, so nothing was saved.</p>
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </Step>
        </div>

        <div className="space-y-14">
          <Step
            n={2}
            id="step-review"
            title={draft ? `Review draft v${draft.version}` : 'Review the draft'}
            sub={
              draft ? (
                <>
                  Drafted by {draft.createdBy}, {shortDate(draft.createdAt)}. Tap a line number to see the sentence a cap came from.
                  {edited && <strong className="mt-1 block font-semibold text-ink">You’ve edited the rules since this draft. Draft again to review your edits; signing signs the draft shown here.</strong>}
                </>
              ) : (
                'Edit the rules, then Draft policy. You’ll see each category with its caps, the sentence it came from, and what changes.'
              )
            }
          >
            {draft ? <DraftReview draft={draft} onPoint={setPoint} /> : <EmptyReview />}
          </Step>

          {draft && draft.status === 'open' && (
            <Step n={3} id="step-queue" title="Requests waiting now" sub={`What each request in the queue gets under v${draft.baseVersion} and under this draft, priced by code.`}>
              <QueuePreview rows={draft.queue} version={draft.version} />
            </Step>
          )}

          {draft && (
            <Step
              n={draft.status === 'open' ? 4 : 3}
              id="step-sign"
              title={draft.status === 'activated' ? 'Signed' : `Two organizers sign`}
              sub={draft.status === 'open' ? 'Two different organizers, each on their own device. The second signature makes this draft the active policy.' : undefined}
            >
              <SignPanel draft={draft} session={session} organizers={organizers} demoMode={view.demoMode} onSigned={(r) => void onSigned(r)} />
            </Step>
          )}
        </div>
      </div>

      {view.versions.length > 0 && (
        <section aria-labelledby="versions-h" className="mt-20 max-w-[720px]">
          <h2 id="versions-h" className="text-[1.3rem] text-ink">
            Versions
          </h2>
          <p className="mt-1 text-[0.88rem] text-ink-3">Every version is kept and never edited. Each payout names the version it was approved under.</p>
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {[...view.versions].reverse().map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <p className="text-[0.95rem] text-ink">
                  <strong className="font-semibold">v{v.version}</strong>
                  <span className="text-ink-2">{v.approvedBy.length ? `, approved by ${v.approvedBy.join(' and ')}` : ''}</span>
                </p>
                <p className="text-[0.85rem] text-ink-3">
                  <span className={cx('mr-2 rounded-full px-2 py-0.5 text-[0.75rem] font-medium', v.status === 'active' ? 'bg-pine-wash text-pine' : 'border border-rule text-ink-2')}>{v.status === 'active' ? 'Active' : 'Retired'}</span>
                  {v.activatedAt ? shortDate(v.activatedAt) : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EmptyReview() {
  return (
    <div className="rounded-2xl border border-dashed border-rule-strong p-6 text-[0.95rem] text-ink-2">
      <p className="font-display text-[1.15rem] text-ink">No draft open.</p>
      <p className="mt-1">
        Try changing a cap, or adding a line such as <q className="font-display">Baby supplies (diapers, formula, wipes): up to $80 per request, $160 per household in 30 days.</q>
      </p>
    </div>
  );
}
