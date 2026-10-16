'use client';

import type { Lang } from '@neighborline/core';
import { Play, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Organizer, PlayMode, RuntimeModes, ScenarioId } from '@/lib/types';
import { api } from '@/lib/api';
import { cx } from '@/lib/format';
import { Chip } from '../RailChips';
import { Wordmark } from '../Wordmark';
import { OrganizerPhone } from './OrganizerPhone';
import { RailTimeline } from './RailTimeline';
import { RequesterPhone } from './RequesterPhone';
import { Stopwatch } from './Stopwatch';
import { buildSteps, clockFrom, splitFrom, storyClock } from './stage-steps';
import { useStage } from './useStage';

export interface ScenarioOption {
  id: ScenarioId;
  title: string;
  blurb: string;
  lang: Lang;
  sms: boolean;
  contactLabel: string;
}

const PHONE_OWNER: Record<ScenarioId, string> = {
  lan: 'Mrs. Lan’s phone',
  rosa: 'Rosa’s phone',
  jean: 'Jean’s phone',
  walter: 'Walter’s phone',
  blocked: 'Unknown sender’s phone',
};
const IDLE: Record<ScenarioId, [string, string]> = {
  lan: ['Mrs. Lan’s power has been out for two days.', 'Press Play scenario and she leaves a voice note in Vietnamese.'],
  rosa: ['Rosa hasn’t worked since the storm.', 'Press Play scenario and she asks for groceries, in Spanish.'],
  jean: ['Jean’s insulin ran out.', 'Press Play scenario and he asks for the copay, in Haitian Creole.'],
  walter: ['Walter’s oxygen battery is running low.', 'Press Play scenario and he asks for a ride to the warming center.'],
  blocked: ['Someone is pretending to be an organizer.', 'Press Play scenario and watch the rail stop them.'],
};
/** Each phone has its own life: Lan's is nearly flat after two days without power. */
const BATTERY: Record<ScenarioId, number> = { lan: 23, rosa: 46, jean: 34, walter: 62, blocked: 88 };
const NEXT: Partial<Record<ScenarioId, ScenarioId>> = { lan: 'rosa', rosa: 'blocked', blocked: 'jean', jean: 'walter' };

type Tab = 'requester' | 'organizers' | 'rail';

export function Stage({
  organizers,
  scenarios,
  modes,
  initial,
}: {
  organizers: Organizer[];
  scenarios: ScenarioOption[];
  modes: RuntimeModes;
  initial: { scenario: ScenarioId; mode: PlayMode; speed?: number; autoplay: boolean };
}) {
  const [scenario, setScenario] = useState<ScenarioId>(initial.scenario);
  const [mode, setMode] = useState<PlayMode>(initial.mode);
  const [translated, setTranslated] = useState(true);
  const [tab, setTab] = useState<Tab>('requester');
  const s = useStage(organizers);
  const dana = organizers.find((o) => o.id === 'org_dana')!;
  const marcus = organizers.find((o) => o.id === 'org_marcus')!;
  const active = scenarios.find((x) => x.id === (s.run?.scenario ?? scenario))!;
  const nameOf = useCallback((id: string) => organizers.find((o) => o.id === id)?.name ?? 'Organizer', [organizers]);

  const steps = useMemo(
    () => buildSteps({ scenario: s.run?.scenario ?? scenario, events: s.events, view: s.view, organizerName: nameOf, claimScripted: modes.paypalMode !== 'sandbox' }),
    [s.run, scenario, s.events, s.view, nameOf, modes.paypalMode],
  );
  const clock = useMemo(() => clockFrom(s.events), [s.events]);
  // Phone clocks: 7:42 on the story's morning, advancing with the run (status bars and bubbles agree).
  const storyStart = s.events.find((e) => e.event.type === 'request.created')?.at ?? null;
  const lastAt = s.events.reduce((m, e) => Math.max(m, e.at), storyStart ?? 0);
  const phoneTime = storyClock(storyStart)(lastAt);
  const bubbleTime = useMemo(() => storyClock(storyStart, { ampm: true }), [storyStart]);
  const paid = clock.kind === 'stopped' && clock.reason === 'paid';
  const finished = clock.kind === 'stopped';
  const runningMode = s.run?.mode ?? mode;
  const railRef = useRef<HTMLDivElement>(null);
  // Keep the newest rail event in view when the column scrolls (long scenarios at 1080p).
  useEffect(() => {
    const box = railRef.current;
    if (!box || box.scrollHeight <= box.clientHeight) return;
    const target = box.querySelector('[data-state="active"]') ?? [...box.querySelectorAll('[data-state="done"],[data-state="money"],[data-state="warn"],[data-state="blocked"]')].at(-1);
    if (!(target instanceof HTMLElement)) return;
    const y = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: Math.max(0, y - box.clientHeight * 0.55), behavior: 'smooth' });
  }, [steps]);
  const marcusTurn =
    runningMode === 'manual' && !!s.view && s.view.request.status === 'awaiting_approval' && s.view.approvals.length === 1 && !s.view.approvals.some((a) => a.organizerId === marcus.id);

  const start = useCallback(() => {
    setTab('requester');
    void s.play(scenario, mode, initial.speed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, mode, initial.speed, s.play]);

  useEffect(() => {
    if (initial.autoplay) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On small screens, follow the action between tabs.
  useEffect(() => {
    if (marcusTurn) setTab('organizers');
  }, [marcusTurn]);

  const captions = {
    idle: 'The clock starts when the voice note arrives.',
    running: runningMode === 'manual' && marcusTurn ? 'Waiting for you to approve as Marcus' : s.view?.request.status === 'unclaimed'
            ? modes.paypalMode === 'sandbox'
              ? `Unclaimed — waiting for ${active.title} to claim it`
              : `Unclaimed — helping ${active.title} claim it`
            : 'Running',
    paid: `Stopped at the verified SUCCESS webhook · ${s.view?.payout?.item.wallet === 'VENMO' ? 'Venmo' : 'PayPal'}`,
    blocked: 'Stopped · blocked before any money moved',
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-rule">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 lg:px-8">
          <Link href="/" aria-label="Neighborline home" className="rounded-md">
            <Wordmark lit={paid} />
          </Link>
          <p className="hidden text-[0.9rem] text-ink-3 2xl:block">Eastside, the morning after the ice storm</p>
          <fieldset className="order-3 w-full min-w-0 xl:order-none xl:w-auto">
            <legend className="sr-only">Scenario</legend>
            <div className="flex gap-1 overflow-x-auto rounded-full border border-rule bg-raised p-1">
              {scenarios.map((sc) => (
                <label
                  key={sc.id}
                  className={cx(
                    'relative flex min-h-10 shrink-0 cursor-pointer items-center rounded-full px-3.5 text-[0.9rem] transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ink',
                    scenario === sc.id ? 'bg-ink text-raised' : 'text-ink-2 hover:bg-sunk',
                  )}
                  title={sc.blurb}
                >
                  <input type="radio" name="scenario" value={sc.id} checked={scenario === sc.id} onChange={() => setScenario(sc.id)} className="sr-only" />
                  {sc.title}
                  <span className={cx('ml-1.5 text-[0.75rem]', scenario === sc.id ? 'text-raised/75' : 'text-ink-3')}>{sc.lang.toUpperCase()}</span>
                  <span className="sr-only"> — {sc.blurb}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[0.9rem] text-ink-2">
              <input
                type="checkbox"
                role="switch"
                checked={mode === 'manual'}
                onChange={(e) => setMode(e.target.checked ? 'manual' : 'auto')}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="relative h-6 w-10 rounded-full border border-rule-strong bg-sunk transition-colors peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink after:absolute after:left-0.5 after:top-0.5 after:size-[18px] after:rounded-full after:bg-raised after:shadow after:transition-transform peer-checked:after:translate-x-4"
              />
              I’ll approve as Marcus
            </label>
            <button
              type="button"
              onClick={start}
              disabled={s.busy === 'play'}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[0.95rem] font-semibold text-raised transition-transform active:scale-[0.98] disabled:opacity-70"
            >
              {s.run ? <RotateCcw size={17} aria-hidden /> : <Play size={17} fill="currentColor" aria-hidden />}
              {s.run ? 'Play again' : 'Play scenario'}
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1 px-4 pb-10 pt-5 lg:px-8">
        <h1 className="sr-only">Neighborline live demo: {active.blurb}</h1>
        {s.error && (
          <p role="alert" className="mb-4 rounded-xl bg-signal-wash px-4 py-3 text-[0.95rem] text-signal">
            {s.error}
          </p>
        )}

        {/* Tabs below 1024px */}
        <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-rule bg-paper/95 px-4 pb-3 pt-1 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <div role="tablist" aria-label="Stage views" className="flex gap-1">
              {(
                [
                  ['requester', 'Neighbor'],
                  ['organizers', 'Organizers'],
                  ['rail', 'Rail'],
                ] as Array<[Tab, string]>
              ).map(([k, l]) => (
                <button
                  key={k}
                  role="tab"
                  id={`tab-${k}`}
                  aria-selected={tab === k}
                  aria-controls={`panel-${k}`}
                  onClick={() => setTab(k)}
                  className={cx('min-h-10 rounded-full px-3 text-[0.88rem]', tab === k ? 'bg-ink text-raised' : 'text-ink-2')}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="text-right">
              <Stopwatch clock={clock} skewMs={s.skew.current} size="sm" caption={{ idle: '', running: '', paid: '', blocked: '' }} />
            </div>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-x-10 lg:gap-y-10 stage:grid-cols-[392px_808px_minmax(0,1fr)] stage:gap-x-12">
          <section id="panel-requester" role="tabpanel" aria-labelledby="tab-requester" className={cx(tab !== 'requester' && 'hidden', 'lg:block')}>
            <PhoneCaption title={PHONE_OWNER[active.id]} sub={active.sms ? 'Simulated SMS' : 'Neighbor · voice note'} />
            <div className="mx-auto max-w-[360px] stage:max-w-[392px]">
              <RequesterPhone
                label={PHONE_OWNER[active.id]}
                thread={s.thread}
                lang={active.lang}
                translated={translated}
                onToggleTranslated={() => setTranslated((v) => !v)}
                warm={paid}
                time={phoneTime}
                timeOf={bubbleTime}
                battery={BATTERY[active.id]}
                sms={active.sms}
                contactLabel={active.contactLabel}
                idleHint={
                  !s.run && (
                    <div className="m-auto max-w-[24ch] py-10 text-center">
                      <p className="font-display text-[1.15rem] leading-snug text-ink">{IDLE[active.id][0]}</p>
                      <p className="mt-2 text-[0.85rem] leading-snug text-ink-3">{IDLE[active.id][1]}</p>
                    </div>
                  )
                }
              />
            </div>
          </section>

          <section id="panel-organizers" role="tabpanel" aria-labelledby="tab-organizers" className={cx(tab !== 'organizers' && 'hidden', 'lg:block')}>
            <div className="grid gap-8 sm:grid-cols-2 sm:gap-5 stage:gap-6">
              <div>
                <PhoneCaption title="Dana’s phone" sub="Organizer" />
                <div className="mx-auto max-w-[360px] stage:max-w-[392px]">
                  <OrganizerPhone label="Dana’s phone, organizer" time={phoneTime} me={dana} view={s.view} onApprove={() => s.approve(dana.id)} busy={s.busy === dana.id} signHint="Signs with Dana’s demo key (held by this demo server)" />
                </div>
              </div>
              <div>
                <PhoneCaption
                  title="Marcus’s phone"
                  sub={runningMode === 'manual' ? 'Organizer · that’s you' : 'Organizer'}
                  badge={marcusTurn ? 'Your turn' : undefined}
                />
                <div className="mx-auto max-w-[360px] stage:max-w-[392px]">
                  <OrganizerPhone
                    label="Marcus’s phone, organizer"
                    time={phoneTime}
                    me={marcus}
                    view={s.view}
                    onApprove={() => s.approve(marcus.id)}
                    busy={s.busy === marcus.id}
                    highlight={marcusTurn}
                    signHint={runningMode === 'manual' ? 'Your device asks for Face ID, Touch ID or your PIN, then signs this exact payout as Marcus' : 'Signs with Marcus’s demo key (held by this demo server)'}
                    fallback={
                      s.fallback?.organizerId === marcus.id
                        ? { reason: s.fallback.reason, label: 'Marcus’s demo key', onUseDemoKey: () => void s.approve(marcus.id, { useDemoKey: true }) }
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
          </section>

          <aside
            id="panel-rail"
            role="tabpanel"
            aria-labelledby="tab-rail"
            className={cx(tab !== 'rail' && 'hidden', 'lg:col-span-2 lg:block stage:col-span-1')}
          >
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-10 stage:sticky stage:top-5 stage:flex stage:max-h-[calc(100dvh-112px)] stage:flex-col stage:gap-0">
              <div className="border-b border-rule pb-6 lg:border-b-0 stage:border-b">
                <h2 className="font-sans text-[0.95rem] font-medium tracking-normal text-ink-2">{active.sms ? 'Message to decision' : 'Voice note to cash'}</h2>
                <div className="mt-2">
                  <Stopwatch clock={clock} skewMs={s.skew.current} caption={captions} splitAt={(t) => splitFrom(s.events, t)} />
                </div>
                {modes.paypalMode === 'sandbox' && s.view?.request.status === 'unclaimed' && s.view.payout && (
                  <SandboxUnclaimed name={active.title} batchId={s.view.payout.batch.id} itemId={s.view.payout.item.id} />
                )}
                {finished && NEXT[s.run?.scenario ?? scenario] && (
                  <button
                    type="button"
                    onClick={() => setScenario(NEXT[s.run?.scenario ?? scenario]!)}
                    className="mt-4 min-h-10 rounded-full border border-rule-strong px-4 text-[0.9rem] text-ink hover:bg-sunk"
                  >
                    Next: {scenarios.find((x) => x.id === NEXT[s.run?.scenario ?? scenario])?.blurb}
                  </button>
                )}
              </div>
              <div className="pt-5 lg:pt-0 stage:flex stage:min-h-0 stage:flex-1 stage:flex-col stage:pt-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-[1.35rem] text-ink">PayPal rail</h2>
                  <div className="flex items-center gap-2">
                    {modes.paypalMode !== 'sandbox' && <Chip>Sandbox: simulated</Chip>}
                    <Chip tone={s.conn === 'open' ? 'pass' : 'review'}>{s.conn === 'open' ? 'Live' : s.conn === 'connecting' ? 'Connecting' : 'Reconnecting'}</Chip>
                  </div>
                </div>
                <div ref={railRef} tabIndex={0} role="region" aria-label="PayPal rail events, scrollable" className="rounded-lg stage:-mr-3 stage:min-h-0 stage:flex-1 stage:overflow-y-auto stage:pr-3">
                  <RailTimeline steps={steps} />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

/** Real sandbox: nobody can claim for the neighbor, so say so and let an organizer return the money. */
function SandboxUnclaimed({ name, batchId, itemId }: { name: string; batchId: string; itemId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  return (
    <div className="mt-4 rounded-xl border border-dashed border-rule-strong p-3 text-[0.88rem] text-ink-2">
      <p>
        In the PayPal sandbox the claim happens in {name}’s own PayPal account, so the clock keeps running until she does. Unclaimed money returns to the fund
        after 30 days, or now:
      </p>
      <button
        type="button"
        disabled={state === 'busy' || state === 'done'}
        onClick={async () => {
          setState('busy');
          try {
            await api.cancelItem(batchId, itemId);
            setState('done');
          } catch {
            setState('error');
          }
        }}
        className="mt-2 min-h-10 rounded-full border border-rule-strong px-4 text-ink hover:bg-sunk disabled:opacity-60"
      >
        {state === 'done' ? 'Cancelled · money returned' : state === 'error' ? 'Couldn’t cancel — try again' : 'Cancel unclaimed payout'}
      </button>
    </div>
  );
}

function PhoneCaption({ title, sub, badge }: { title: string; sub: string; badge?: string }) {
  return (
    <div className="mx-auto mb-3 flex max-w-[360px] stage:max-w-[392px] items-baseline justify-between gap-3 px-1">
      <h2 className="font-display text-[1.15rem] text-ink">{title}</h2>
      {badge ? (
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-[0.8rem] font-semibold text-raised animate-rise">{badge}</span>
      ) : (
        <span className="text-[0.85rem] text-ink-3">{sub}</span>
      )}
    </div>
  );
}
