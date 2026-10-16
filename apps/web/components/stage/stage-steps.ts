/**
 * Pure: turn the StageEvents of one run into the rows of the "PayPal rail" timeline.
 * Expected steps are listed up front (ghosted) so viewers can see where the money is going.
 */
import type { StageEvent } from '@neighborline/core';
import type { RequestView, ScenarioId } from '@/lib/types';
import { LANGUAGE_NAMES, money } from '@/lib/format';

export type StepState = 'pending' | 'done' | 'money' | 'blocked' | 'warn' | 'active';

export interface Step {
  key: string;
  title: string;
  detail?: string;
  ids?: Array<[string, string]>;
  state: StepState;
  atMs?: number; // offset from the voice note
}

export interface TimedEvent {
  event: StageEvent;
  /** server timestamp, ms */
  at: number;
}

const PLAN: Record<'voice' | 'rescue' | 'blocked', string[]> = {
  voice: ['received', 'transcribed', 'readback', 'confirmed', 'approval1', 'approval2', 'batch', 'webhook', 'success', 'callback'],
  rescue: ['received', 'transcribed', 'readback', 'confirmed', 'approval1', 'approval2', 'batch', 'webhook', 'unclaimed', 'claimhelp', 'webhook2', 'success', 'callback'],
  blocked: ['received', 'flag_lookalike', 'flag_injection', 'disabled', 'reply'],
};

export function planFor(scenario: ScenarioId | null): string[] {
  if (scenario === 'blocked') return PLAN.blocked;
  if (scenario === 'rosa') return PLAN.rescue;
  return PLAN.voice;
}

export function buildSteps(input: {
  scenario: ScenarioId | null;
  events: TimedEvent[];
  view: RequestView | null;
  organizerName: (id: string) => string;
}): Step[] {
  const { scenario, events, view } = input;
  const plan = planFor(scenario);
  const lang = view?.request.lang ?? (scenario === 'rosa' ? 'es' : scenario === 'jean' ? 'ht' : scenario === 'walter' || scenario === 'blocked' ? 'en' : 'vi');
  const langName = LANGUAGE_NAMES[lang].en;
  const NAMES: Record<ScenarioId, string> = { lan: 'Lan', rosa: 'Rosa', jean: 'Jean', walter: 'Walter', blocked: 'Sender' };
  const who = view?.requester.displayName ?? (scenario ? NAMES[scenario] : 'Neighbor');
  const t0 = events.find((e) => e.event.type === 'request.created')?.at;
  const off = (at: number) => (t0 === undefined ? undefined : at - t0);

  const steps = new Map<string, Step>();
  const ghost = (key: string, title: string, detail?: string) => steps.set(key, { key, title, detail, state: 'pending' });

  // Ghost rows: what will happen.
  ghost('received', scenario === 'blocked' ? 'Text message received' : 'Voice note received');
  ghost('transcribed', 'Transcribed and translated');
  ghost('readback', `Read back in ${langName}`);
  ghost('confirmed', `${who} confirms`);
  ghost('approval1', 'Approval 1 of 2');
  ghost('approval2', 'Approval 2 of 2');
  ghost('batch', 'PayPal Payouts batch created');
  ghost('webhook', 'Webhook verified');
  ghost('unclaimed', 'Item UNCLAIMED');
  ghost('claimhelp', `Claim help sent in ${langName}`);
  ghost('webhook2', 'Webhook verified');
  ghost('success', 'Item SUCCESS');
  ghost('callback', `Callback sent in ${langName}`);
  ghost('flag_lookalike', 'Rail protection checks the payout handle');
  ghost('flag_injection', 'Instructions inside the message');
  ghost('disabled', 'Approve buttons');
  ghost('reply', 'Reply to sender');

  let webhooks = 0;
  let notifies = 0;
  const set = (key: string, patch: Partial<Step>) => {
    const cur = steps.get(key);
    if (cur) steps.set(key, { ...cur, ...patch });
  };

  for (const { event: e, at } of events) {
    const atMs = off(at);
    switch (e.type) {
      case 'request.created':
        set('received', {
          state: 'done',
          atMs,
          detail:
            e.channel === 'sms'
              ? 'SMS from an unknown number'
              : `${LANGUAGE_NAMES[e.lang].en}${view?.audioSeconds ? ` · 0:${String(view.audioSeconds).padStart(2, '0')}` : ''} · web voice line`,
        });
        break;
      case 'request.transcribed':
        set('transcribed', { state: 'done', atMs, detail: 'Speech-to-text, then a schema-checked summary. No amounts from AI.' });
        break;
      case 'request.readback':
        if (scenario === 'blocked') set('reply', { state: 'done', atMs, title: 'Reply sent · no money moved', detail: 'Sender asked to describe their own need, in their own words.' });
        else set('readback', { state: 'done', atMs, detail: `${who} hears what we understood before anything is filed` });
        break;
      case 'request.confirmed': {
        const c = view?.request.computed;
        set('confirmed', {
          state: 'done',
          atMs,
          title: `${who} confirmed`,
          detail: c ? `${c.ruleCitation} → ${money(c.amountCents)}, computed by code` : undefined,
        });
        break;
      }
      case 'request.flagged':
        for (const f of e.flags) {
          if (f.code === 'LOOKALIKE_HANDLE' || f.code === 'DEST_IS_GROUP_HANDLE')
            set('flag_lookalike', { state: 'blocked', atMs, title: 'Lookalike handle blocked', detail: f.detail });
          if (f.code === 'PROMPT_INJECTION') set('flag_injection', { state: 'warn', atMs, title: 'Injected instructions ignored', detail: f.detail });
        }
        set('disabled', { state: 'blocked', atMs, title: 'Approve disabled on every phone', detail: 'The approval service refuses to build a batch for a blocked destination.' });
        break;
      case 'approval.added':
        set(e.count >= 2 ? 'approval2' : 'approval1', {
          state: 'done',
          atMs,
          title: `Approval ${Math.min(e.count, 2)} of 2 · ${input.organizerName(e.organizerId)}`,
          detail: e.count >= 2 ? 'Two different people, two different phones' : 'Waiting for a second organizer',
        });
        break;
      case 'payout.batch_created':
        set('batch', {
          state: 'done',
          atMs,
          detail: `${e.itemCount} item · ${money(e.totalCents)} · purpose DONATIONS`,
          ids: [
            ['sender_batch_id', e.senderBatchId],
            ['payout_batch_id', e.paypalBatchId ?? '—'],
          ],
        });
        break;
      case 'payout.item_updated':
        if (e.status === 'PENDING') {
          const cur = steps.get('batch');
          if (cur?.ids && e.paypalItemId) set('batch', { ids: [...cur.ids, ['payout_item_id', e.paypalItemId]] });
        } else if (e.status === 'UNCLAIMED') {
          set('unclaimed', { state: 'warn', atMs, title: 'Item UNCLAIMED', detail: 'That email has no PayPal account yet. The money waits 30 days.' });
        } else if (e.status === 'SUCCESS') {
          set('success', {
            state: 'money',
            atMs,
            title: scenario === 'rosa' ? `${who} claimed it · SUCCESS` : 'Item SUCCESS · money landed',
            ids: e.transactionId ? [['transaction_id', e.transactionId]] : undefined,
          });
        } else {
          set('success', { state: 'blocked', atMs, title: `Item ${e.status}` });
        }
        break;
      case 'webhook.verified':
        webhooks++;
        set(webhooks === 1 ? 'webhook' : 'webhook2', { state: 'done', atMs, detail: `${e.eventType} · signature checked` });
        break;
      case 'notify.sent':
        notifies++;
        if (scenario === 'blocked') {
          set('reply', { state: 'done', atMs, title: 'Reply sent · no money moved', detail: 'The sender is asked to describe their own need, in their own words.' });
          break;
        }
        if (scenario === 'rosa' && notifies === 1) set('claimhelp', { state: 'done', atMs, detail: 'How to open a PayPal account with that email, step by step' });
        else set('callback', { state: 'done', atMs, title: `Callback sent in ${LANGUAGE_NAMES[e.lang].en}`, detail: 'From a vetted template, slots filled by code' });
        break;
      default:
        break;
    }
  }

  const rows = plan.map((k) => steps.get(k)!);
  // The first pending row after the last completed one is "active".
  const lastDone = rows.map((r) => r.state !== 'pending').lastIndexOf(true);
  if (events.length && lastDone >= 0 && lastDone < rows.length - 1 && rows[lastDone + 1]!.state === 'pending') {
    rows[lastDone + 1] = { ...rows[lastDone + 1]!, state: 'active' };
  }
  return rows;
}

export type ClockState = { kind: 'idle' } | { kind: 'running'; startAt: number } | { kind: 'stopped'; ms: number; reason: 'paid' | 'blocked' };

export function clockFrom(events: TimedEvent[]): ClockState {
  const start = events.find((e) => e.event.type === 'request.created');
  if (!start) return { kind: 'idle' };
  const paid = events.find((e) => e.event.type === 'payout.item_updated' && e.event.status === 'SUCCESS');
  if (paid) return { kind: 'stopped', ms: paid.at - start.at, reason: 'paid' };
  const flagged = events.find((e) => e.event.type === 'request.flagged' && e.event.flags.some((f) => f.severity === 'block'));
  if (flagged) return { kind: 'stopped', ms: flagged.at - start.at, reason: 'blocked' };
  return { kind: 'running', startAt: start.at };
}
