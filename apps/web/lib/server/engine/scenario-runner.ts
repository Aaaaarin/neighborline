/**
 * /demo "Play scenario": drives the REAL engine with a bundled sample — the same public methods the
 * phones call (submitAudio/submitText → confirmIntake → approve ×2). Only the human beats are
 * scripted (time to listen to the read-back, time for an organizer to look at the card); every
 * stage event comes from a real engine action, so the stopwatch shows real latency.
 */
import { randomBytes } from 'node:crypto';
import type { Channel, Lang } from '@neighborline/core';
import type { PlayMode, ScenarioId, ScenarioRun } from '../../types';
import { HttpError } from '../errors';
import { SCENARIOS } from '../fixtures/scenarios';
import type { Services } from '../services';
import { DEMO_PREFIX, type Ctx } from './context';

/** Beats at speed 1, in ms. */
export const BEATS = {
  noteArrives: 1_500, // the voice note uploads; the bubble is visible before transcription
  listen: 7_000, // the neighbor listens to the read-back (a ~25 s voice message) and taps "yes"
  firstLook: 6_000, // the first organizer reads the card
  secondLook: 6_000, // the second organizer, on another phone
  claimHelp: 6_000, // after the claim-help message, the neighbor opens PayPal and claims
};

export interface RunnerHost {
  services: Services;
  /** Create the request with a demo id (demo rehearsals never count against real households). */
  startDemoIntake(id: string, channel: Channel, lang: Lang): Promise<void>;
  /** submitAudio for a bundled sample, filling an existing "voice note" bubble. */
  submitSampleInto(id: string, sample: ScenarioId, bubbleId: string): Promise<unknown>;
  /** Register a cleanup to run if the demo is reset. */
  onReset(fn: () => void): void;
}

export async function playScenario(host: RunnerHost, ctx: Ctx, input: { scenario: ScenarioId; mode: PlayMode; speed?: number }): Promise<ScenarioRun> {
  const s = SCENARIOS[input.scenario];
  if (!s) throw new HttpError(400, 'Unknown scenario');
  const speed = Math.min(20, Math.max(0.25, input.speed ?? 1));
  const mode = input.mode;
  const svc = host.services;
  const id = `${DEMO_PREFIX}${randomBytes(6).toString('hex')}`;
  const run: ScenarioRun = { requestId: id, scenario: s.id, mode, speed, manualOrganizerId: mode === 'manual' ? 'org_marcus' : null };
  ctx.meta.ensure(id, { displayName: s.requester.displayName, area: s.requester.area, scenario: s.id, speed, ...(s.payout.nameOnFile ? { nameOnFile: s.payout.nameOnFile } : {}) });
  await host.startDemoIntake(id, s.channel, s.lang);
  const warn = (step: string) => (err: unknown) => console.warn(`[scenario ${s.id}] ${step} failed:`, err instanceof Error ? err.message : err);

  if (s.outcome === 'blocked') {
    // A text arrives; rail protection runs as soon as the destination is known.
    ctx.later(BEATS.noteArrives * 0.8, () => svc.submitText(id, { text: s.transcript, lang: s.lang }).catch(warn('submitText')), speed);
    return run;
  }

  // The voice note arrives: bubble first, transcript fills in when speech-to-text finishes.
  const bubble = ctx.meta.message(id, { from: 'neighbor', kind: 'voice', lang: s.lang, text: '', ...(s.audioSeconds ? { meta: { audioSeconds: s.audioSeconds } } : {}) });
  const marcus = () => svc.approve({ requestIds: [id], organizerId: 'org_marcus', deviceLabel: "Marcus's phone" }).catch(warn('approve Marcus'));
  const dana = async () => {
    await svc.approve({ requestIds: [id], organizerId: 'org_dana', deviceLabel: "Dana's phone" }).catch(warn('approve Dana'));
    if (mode === 'auto') ctx.later(BEATS.secondLook, marcus, speed);
  };
  const confirm = async () => {
    const c = await svc.confirmIntake(id, { confirmed: true });
    const v = await svc.getRequest(id);
    if (c.status !== 'awaiting_approval' || !v || v.request.railFlags.some((f) => f.severity === 'block')) return;
    ctx.later(BEATS.firstLook, dana, speed);
  };
  ctx.later(
    BEATS.noteArrives,
    async () => {
      await host.submitSampleInto(id, s.id, bubble.id);
      ctx.later(BEATS.listen, () => confirm().catch(warn('confirm')), speed);
    },
    speed,
  );

  // UNCLAIMED → claim help sent → (fake mode) she opens PayPal with that email and claims, after a beat.
  // In sandbox mode nobody can claim for her: the stage honestly waits and an organizer may cancel.
  if (ctx.fake) {
    const fake = ctx.fake;
    let done = false;
    const stop = () => {
      done = true;
      unsubscribe();
    };
    const unsubscribe = ctx.bus.subscribe((m) => {
      if (done || m.kind !== 'stage' || !m.requestIds.includes(id)) return;
      const e = m.event;
      if (e.type === 'payout.item_updated' && e.status !== 'PENDING' && e.status !== 'UNCLAIMED') return stop();
      if (e.type === 'notify.sent' && ctx.meta.get(id)?.thread.some((t) => t.kind === 'claim_help')) {
        stop();
        ctx.later(
          BEATS.claimHelp,
          async () => {
            const item = (await svc.getRequest(id))?.payout?.item;
            if (item?.paypalItemId && item.status === 'UNCLAIMED') await fake.claimItem(item.paypalItemId);
          },
          speed,
        );
      }
    });
    host.onReset(stop);
    ctx.later(10 * 60_000, stop, 1);
  }
  return run;
}
