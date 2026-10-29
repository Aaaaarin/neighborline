/**
 * Pure: turn the StageEvents of one run into the rows of the "PayPal rail" timeline.
 * Expected steps are listed up front (ghosted) so viewers can see where the money is going.
 */
import type { StageEvent } from '@neighborline/core';
import type { RequestView, ScenarioId } from '@/lib/types';
import { LANGUAGE_NAMES, money, tidyQuotes } from '@/lib/format';

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

/** After PayPal refuses the batch at the account level, the run ends here instead of at a webhook. */
const REFUSED_TAIL = ['rail_alert', 'rail_told'];

export function planFor(scenario: ScenarioId | null, opts: { refused?: boolean } = {}): string[] {
  if (opts.refused && scenario !== 'blocked') {
    const p = scenario === 'rosa' ? PLAN.rescue : PLAN.voice;
    return [...p.slice(0, p.indexOf('batch') + 1), ...REFUSED_TAIL];
  }
  if (scenario === 'blocked') return PLAN.blocked;
  if (scenario === 'rosa') return PLAN.rescue;
  return PLAN.voice;
}

export function buildSteps(input: {
  scenario: ScenarioId | null;
  events: TimedEvent[];
  view: RequestView | null;
  organizerName: (id: string) => string;
  /** fake PayPal: the neighbor's claim is scripted by the demo, so say so */
  claimScripted?: boolean;
}): Step[] {
  const { scenario, events, view } = input;
  const refused = railRefusal(events) !== null;
  const plan = planFor(scenario, { refused });
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
  ghost('callback', `Messaged back in ${langName}`);
  ghost('flag_lookalike', 'Rail protection checks the payout handle');
  ghost('flag_injection', 'Instructions inside the message');
  ghost('disabled', 'Approve buttons');
  ghost('reply', 'Reply to sender');
  ghost('rail_alert', 'Organizers alerted');
  ghost('rail_told', `${who} told in ${langName}`);

  let webhooks = 0;
  let notifies = 0;
  let refusedSeen = false;
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
              ? 'From an unknown number · the SMS channel is simulated in this demo'
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
          if (f.code === 'PROMPT_INJECTION') set('flag_injection', { state: 'warn', atMs, title: 'Injected instructions ignored', detail: tidyQuotes(f.detail, view?.request.originalText) });
        }
        set('disabled', { state: 'blocked', atMs, title: 'Approve disabled on every phone', detail: 'The approval service refuses to build a batch for a blocked destination.' });
        break;
      case 'approval.added': {
        const signer = view?.approvals.find((a) => a.organizerId === e.organizerId)?.signer;
        const signed = signer ? (signer.kind === 'passkey' ? `Signed with passkey on ${signer.deviceLabel}` : `Signed with ${input.organizerName(e.organizerId)}’s demo key`) : 'Signature over the approval hash';
        set(e.count >= 2 ? 'approval2' : 'approval1', {
          state: 'done',
          atMs,
          title: `Approval ${Math.min(e.count, 2)} of 2 · ${input.organizerName(e.organizerId)}`,
          detail: e.count >= 2 ? `${signed}. Two different organizers, two different keys` : `${signed}. Waiting for a second organizer`,
        });
        break;
      }
      case 'payout.batch_created':
        refusedSeen = false;
        set('batch', {
          state: 'done',
          atMs,
          detail: `${e.itemCount} item · ${money(e.totalCents)} · purpose NON_GOODS_OR_SERVICES${view?.sandboxStandIn ? ` · ${view.sandboxStandIn.note}` : ''}`,
          ids: [
            ['sender_batch_id', e.senderBatchId],
            ['payout_batch_id', e.paypalBatchId ?? '—'],
          ],
        });
        break;
      case 'payout.rail_refused':
        refusedSeen = true;
        set('batch', {
          state: 'blocked',
          atMs,
          title: 'PayPal refused this payout',
          detail: `The sponsor’s account needs attention${e.reason ? ` (${e.reason})` : ''}. No money moved.`,
        });
        set('rail_alert', {
          state: 'done',
          atMs,
          detail: e.manualFallback
            ? 'They can record a cash or check hand-over instead, with the same two signatures and a receipt note'
            : 'They can turn on manual recording and record a cash or check hand-over instead',
        });
        break;
      case 'payout.item_updated':
        if (e.status === 'PENDING') {
          const cur = steps.get('batch');
          if (cur?.ids && e.paypalItemId) set('batch', { ids: [...cur.ids, ['payout_item_id', e.paypalItemId]] });
        } else if (e.status === 'UNCLAIMED') {
          set('unclaimed', {
            state: 'warn',
            atMs,
            title: 'Item UNCLAIMED',
            detail: view?.sandboxStandIn ? 'PayPal sandbox: that address has no PayPal account, so the money waits 30 days or until an organizer cancels it.' : 'That email has no PayPal account yet. The money waits 30 days.',
          });
        } else if (e.status === 'SUCCESS') {
          set('success', {
            state: 'money',
            atMs,
            title: scenario === 'rosa' ? `${who} claimed it · SUCCESS` : 'Item SUCCESS · money landed',
            ...(scenario === 'rosa' && input.claimScripted ? { detail: 'Her claim is scripted in this demo: the PayPal stand-in claims it a few seconds after the help message' } : {}),
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
        if (refusedSeen) {
          set('rail_told', { state: 'done', atMs, title: `${who} told in ${LANGUAGE_NAMES[e.lang].en}`, detail: 'A neutral note in the neighbor’s thread: approved, PayPal couldn’t send it yet, the volunteers know' });
          break;
        }
        notifies++;
        if (scenario === 'blocked') {
          set('reply', { state: 'done', atMs, title: 'Reply sent · no money moved', detail: 'The sender is asked to describe their own need, in their own words.' });
          break;
        }
        if (scenario === 'rosa' && notifies === 1) set('claimhelp', { state: 'done', atMs, detail: 'In her thread: how to open a PayPal account with that email, step by step' });
        else set('callback', { state: 'done', atMs, title: `Messaged back in ${LANGUAGE_NAMES[e.lang].en}`, detail: 'In the neighbor’s thread, from a vetted template; code fills the amount and wallet' });
        break;
      default:
        break;
    }
  }

  // Real sandbox: SUCCESS can come from the approver's status poll before PayPal's signed webhook arrives.
  // Show the rows in the order they happened instead of implying the webhook came first.
  const order = [...plan];
  const hook = steps.get('webhook');
  const paidRow = steps.get('success');
  if (hook?.atMs !== undefined && paidRow?.atMs !== undefined && hook.atMs > paidRow.atMs && order.includes('webhook') && !order.includes('webhook2')) {
    order.splice(order.indexOf('webhook'), 1);
    // After every row that had already happened when the webhook arrived (SUCCESS, usually the callback too).
    let at = order.indexOf('success');
    order.forEach((k, i) => {
      const t = steps.get(k)?.atMs;
      if (i > at && t !== undefined && t <= hook.atMs!) at = i;
    });
    order.splice(at + 1, 0, 'webhook');
    steps.set('webhook', { ...hook, detail: `${hook.detail ?? ''} · arrived after PayPal's payout status already said SUCCESS` });
    steps.set('success', { ...paidRow, detail: paidRow.detail ?? "Seen first by the approver's read-only status check" });
  }
  const rows = order.map((k) => steps.get(k)!);
  // The first pending row after the last completed one is "active".
  const lastDone = rows.map((r) => r.state !== 'pending').lastIndexOf(true);
  if (events.length && lastDone >= 0 && lastDone < rows.length - 1 && rows[lastDone + 1]!.state === 'pending') {
    rows[lastDone + 1] = { ...rows[lastDone + 1]!, state: 'active' };
  }
  return rows;
}

export type ClockState =
  | { kind: 'idle' }
  | { kind: 'running'; startAt: number }
  /** `confirmedBy` (paid only): what told us first. In the real sandbox the approver's status poll can see SUCCESS
   *  before PayPal's signed webhook arrives; the caption must not claim a webhook it has not seen yet. */
  | { kind: 'stopped'; ms: number; reason: 'paid' | 'blocked' | 'refused'; confirmedBy?: 'webhook' | 'poll' };

/** PayPal's account-level refusal of this run's batch, unless a later re-send got through. */
export function railRefusal(events: TimedEvent[]): TimedEvent | null {
  let last: TimedEvent | null = null;
  for (const e of events) {
    if (e.event.type === 'payout.rail_refused') last = e;
    else if (e.event.type === 'payout.batch_created') last = null;
  }
  return last;
}

export function clockFrom(events: TimedEvent[]): ClockState {
  const start = events.find((e) => e.event.type === 'request.created');
  if (!start) return { kind: 'idle' };
  const paid = events.find((e) => e.event.type === 'payout.item_updated' && e.event.status === 'SUCCESS');
  if (paid) {
    const hook = events.find((e) => e.event.type === 'webhook.verified' && e.at <= paid.at);
    return { kind: 'stopped', ms: paid.at - start.at, reason: 'paid', confirmedBy: hook ? 'webhook' : 'poll' };
  }
  const flagged = events.find((e) => e.event.type === 'request.flagged' && e.event.flags.some((f) => f.severity === 'block'));
  if (flagged) return { kind: 'stopped', ms: flagged.at - start.at, reason: 'blocked' };
  // PayPal refused the batch: nothing is in flight, so the clock stops instead of running forever (QA-2 P2-3).
  const refused = railRefusal(events);
  if (refused) return { kind: 'stopped', ms: refused.at - start.at, reason: 'refused' };
  return { kind: 'running', startAt: start.at };
}

/**
 * Honest speed: split the clock into time people spent deciding and time the system spent.
 * People: the neighbor listening to the read-back and saying yes (readback → confirmed), the
 * organizers looking at the card (confirmed → second approval), and a neighbor claiming an
 * UNCLAIMED payout (UNCLAIMED → SUCCESS). Everything else — upload, speech-to-text, checks,
 * the Payouts call, PayPal processing, the webhook — is system time.
 */
export interface SpeedSplit {
  totalMs: number;
  humanMs: number;
  machineMs: number;
  /** a person is deciding right now */
  humanNow: boolean;
}

export function splitFrom(events: TimedEvent[], nowMs: number): SpeedSplit | null {
  const start = events.find((e) => e.event.type === 'request.created')?.at;
  if (start === undefined) return null;
  const clock = clockFrom(events);
  const end = clock.kind === 'stopped' ? start + clock.ms : Math.max(start, nowMs);
  const at = (pred: (e: TimedEvent['event']) => boolean) => events.find((e) => pred(e.event))?.at;
  const readback = at((e) => e.type === 'request.readback');
  const confirmed = at((e) => e.type === 'request.confirmed');
  const approved = at((e) => e.type === 'approval.added' && e.count >= 2);
  const unclaimed = at((e) => e.type === 'payout.item_updated' && e.status === 'UNCLAIMED');
  const success = at((e) => e.type === 'payout.item_updated' && e.status === 'SUCCESS');
  let humanMs = 0;
  let humanNow = false;
  const span = (a: number | undefined, b: number | undefined) => {
    if (a === undefined) return;
    const stop = Math.min(b ?? end, end);
    if (b === undefined && clock.kind === 'running') humanNow = true;
    humanMs += Math.max(0, stop - a);
  };
  span(readback, confirmed);
  span(confirmed, approved);
  span(unclaimed, success);
  const totalMs = end - start;
  return { totalMs, humanMs, machineMs: Math.max(0, totalMs - humanMs), humanNow };
}

/**
 * The story's clock: every /demo run happens at 7:42 on the morning after the ice storm. Phone status
 * bars and bubble times both read this clock, offset by the real time since the voice note arrived.
 */
export const STORY_START_MINUTES = 7 * 60 + 42;
export function storyClock(startAt: number | null, opts: { ampm?: boolean } = {}): (at: string | number) => string {
  return (at) => {
    const ms = typeof at === 'number' ? at : Date.parse(at);
    const elapsed = startAt === null || !Number.isFinite(ms) ? 0 : Math.max(0, ms - startAt);
    const total = STORY_START_MINUTES + Math.floor(elapsed / 60_000);
    const h = Math.floor(total / 60) % 24;
    const m = String(total % 60).padStart(2, '0');
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return opts.ampm ? `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}` : `${h12}:${m}`;
  };
}
