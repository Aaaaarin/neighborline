/**
 * The real engine behind the `Services` seam: @neighborline/core (amounts, rail, approvals, state,
 * i18n, report) + @neighborline/db (PGlite / Postgres) + @neighborline/paypal (fake or sandbox) +
 * @neighborline/agents (fixture or live). Payouts go only through lib/server/approval-service.ts.
 */
import type { Channel, HelpRequest, Lang, RequestStatus } from '@neighborline/core';
import { InvalidTransitionError } from '@neighborline/core';
import { createAgents, type Agents } from '@neighborline/agents';
import { createRequest, getRequest, listItemsForRequest, listOrganizers, recordNotification, updateRequest } from '@neighborline/db';
import type {
  ApprovalResult,
  DeclineReasonCode,
  DonationSource,
  PlayMode,
  RuntimeModes,
  ScenarioId,
  StreamMessage,
} from '../../types';
import { ApprovalService, type SentBatch } from '../approval-service';
import { HttpError } from '../errors';
import * as tpl from '../fixtures/templates';
import { SAMPLE_VOICE_NOTES } from '../fixtures/scenarios';
import { FakePayPalControl, createPublicPayPal, type PublicPayPal } from '../paypal';
import type { AudioInput, Services } from '../services';
import type { BaseCtx, Ctx } from './context';
import { openGeneration, retireGeneration, type DbGeneration } from './db-state';
import * as donations from './donations';
import { readConfig, type EngineConfig, type Env } from './env';
import { EventBus, nowIso } from './events';
import * as intake from './intake';
import { buildLedger, runReconcile, type ReconcileCache } from './ledger';
import { MetaStore } from './meta';
import { buildReportView, buildTrust } from './report';
import { playScenario } from './scenario-runner';
import { applyItemStatus } from './settle';
import { getRequestView, getThread, groupView, listRequestViews } from './views';
import { handleWebhook } from './webhooks';

interface GenState {
  ctx: Ctx;
  dead: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
  cleanups: Set<() => void>;
  reconcile: ReconcileCache;
  donations: donations.DonationState;
}

export interface EngineOptions {
  env?: Env;
  agents?: Agents;
}

export class Engine implements Services {
  readonly modes: RuntimeModes;
  readonly cfg: EngineConfig;
  readonly bus = new EventBus();
  private readonly env: Env;
  private readonly agents: Agents;
  private readonly paypal: PublicPayPal;
  private readonly fake: FakePayPalControl | null;
  private readonly approvals: ApprovalService;
  private state: Promise<GenState>;
  private resetting: Promise<void> | null = null;

  constructor(opts: EngineOptions = {}) {
    this.env = opts.env ?? process.env;
    this.cfg = readConfig(this.env);
    this.agents = opts.agents ?? createAgents(this.env, { groupName: 'Eastside Mutual Aid' });
    this.paypal = createPublicPayPal(this.env);
    this.fake = this.cfg.paypalMode === 'fake' ? new FakePayPalControl(this.cfg.fakePaypalUrl) : null;
    this.approvals = new ApprovalService(this.env);
    this.modes = { paypalMode: this.cfg.paypalMode, aiMode: this.agents.providers.mode, engine: 'real' };
    this.state = openGeneration(this.cfg, 1).then((g) => this.makeState(g));
    this.state.catch((err) => console.error('[engine] database boot failed:', err));
  }

  /** Resolves when the database is migrated and seeded (tests, health checks). */
  async ready(): Promise<void> {
    await this.state;
  }

  private makeState(gen: DbGeneration): GenState {
    const st: GenState = {
      dead: false,
      timers: new Set(),
      cleanups: new Set(),
      reconcile: { states: new Map(), at: null },
      donations: { orders: new Map(), tiers: null },
      ctx: undefined as unknown as Ctx,
    };
    st.ctx = {
      gen,
      db: gen.db,
      cfg: this.cfg,
      env: this.env,
      agents: this.agents,
      paypal: this.paypal,
      fake: this.fake,
      approvals: this.approvals,
      bus: this.bus,
      meta: new MetaStore(),
      later: (ms, fn, speed = 1) => {
        if (st.dead) return;
        const t = setTimeout(() => {
          st.timers.delete(t);
          if (st.dead) return;
          Promise.resolve()
            .then(fn)
            .catch((err) => console.warn('[engine] scheduled step failed:', err instanceof Error ? err.message : err));
        }, Math.max(0, (ms * this.cfg.beatScale) / speed));
        st.timers.add(t);
      },
    };
    return st;
  }

  /** The generation an operation runs against, captured once at its start. */
  private async ctx(): Promise<Ctx> {
    return (await this.state).ctx;
  }

  /** Same, without the approval service (intake, views, notifications). */
  private async base(): Promise<BaseCtx> {
    const { approvals: _omit, ...base } = await this.ctx();
    return base;
  }

  /* ---------------- intake ---------------- */

  async startIntake(input: { groupSlug: string; channel: Channel; lang?: Lang }) {
    return intake.startIntake(await this.base(), input);
  }

  async submitAudio(requestId: string, input: AudioInput) {
    const ctx = await this.base();
    if (input.sampleId) {
      const m = ctx.meta.ensure(requestId);
      m.scenario ??= input.sampleId;
    }
    return intake.submitAudio(ctx, requestId, input);
  }

  async submitText(requestId: string, input: { text: string; lang?: Lang }) {
    return intake.submitText(await this.base(), requestId, input);
  }

  async confirmIntake(requestId: string, input: { confirmed: boolean; corrections?: string }) {
    return intake.confirmIntake(await this.base(), requestId, input);
  }

  async getThread(requestId: string) {
    return getThread(await this.base(), requestId);
  }

  listSampleVoiceNotes() {
    return SAMPLE_VOICE_NOTES;
  }

  /* ---------------- organizers ---------------- */

  async getGroup() {
    return groupView(await this.base());
  }

  async listRequests(filter?: { status?: RequestStatus[] }) {
    return listRequestViews(await this.base(), filter);
  }

  async getRequest(requestId: string) {
    return getRequestView(await this.base(), requestId);
  }

  async approve(input: { requestIds: string[]; organizerId: string; deviceLabel: string }): Promise<ApprovalResult> {
    const ctx = await this.ctx();
    const { sent, ...result } = await ctx.approvals.approve({ db: ctx.db, group: ctx.gen.group, bus: ctx.bus }, input);
    if (sent) await this.afterSent(ctx, sent);
    return result;
  }

  /** "Two neighbors said yes — sending now" to each requester; in sandbox, poll as a webhook safety net. */
  private async afterSent(ctx: Ctx, sent: SentBatch) {
    for (const r of sent.requests) {
      const item = sent.items.find((i) => i.requestId === r.id);
      if (!item) continue;
      const n = await ctx.agents.notify.render({ key: 'approved_sending', lang: r.lang, amountCents: item.amountCents, wallet: item.wallet });
      ctx.meta.message(r.id, { from: 'line', kind: 'status', lang: r.lang, text: n.text, textEn: tpl.sending('en').textEn });
      await recordNotification(ctx.db, { requestId: r.id, channel: r.channel, lang: r.lang, messageKey: 'approved_sending', text: n.text, status: 'sent' });
    }
    if (ctx.cfg.paypalMode === 'sandbox' && sent.batch.paypalBatchId) this.pollBatch(ctx, sent.batch.paypalBatchId);
  }

  /**
   * Webhook safety net / localhost fallback: GET the batch at growing intervals and apply item
   * statuses through the same idempotent path as webhooks (a status applied twice is a no-op).
   */
  private pollBatch(ctx: Ctx, paypalBatchId: string) {
    const schedule = [5_000, 15_000, 45_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000];
    const { approvals: _a, ...base } = ctx;
    const tick = (i: number) => {
      ctx.later(schedule[i]!, async () => {
        const items = await this.approvals.pollBatch(paypalBatchId);
        let open = false;
        for (const it of items) {
          if (it.status === 'PENDING' || it.status === 'ONHOLD' || it.status === 'UNCLAIMED') open = true;
          if (it.status === 'PENDING') continue;
          await applyItemStatus(base, { paypalItemId: it.payoutItemId, ...(it.senderItemId ? { senderItemId: it.senderItemId } : {}), status: it.status, ...(it.transactionId ? { transactionId: it.transactionId } : {}), actor: 'paypal-poll' });
        }
        if (open && i + 1 < schedule.length) tick(i + 1);
      });
    };
    tick(0);
  }

  async decline(input: { requestId: string; organizerId: string; reasonCode: DeclineReasonCode; note?: string }) {
    const ctx = await this.base();
    const r = await this.loadReq(ctx, input.requestId);
    const org = (await listOrganizers(ctx.db, ctx.gen.group.id)).find((o) => o.id === input.organizerId);
    if (!org) throw new HttpError(403, 'Unknown organizer');
    if ((await listItemsForRequest(ctx.db, r.id)).length) throw new HttpError(409, 'Already sent to PayPal; it can no longer be declined.');
    try {
      await updateRequest(ctx.db, r.id, { status: 'declined' }, { actor: org.id });
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw new HttpError(409, `This request is ${r.status.replace('_', ' ')} and can’t be declined.`);
      throw err;
    }
    const m = tpl.declined(r.lang, input.reasonCode, input.note);
    const meta = ctx.meta.ensure(r.id);
    meta.decline = { organizerId: org.id, reasonCode: input.reasonCode, ...(input.note ? { note: input.note } : {}), at: nowIso() };
    ctx.meta.message(r.id, { from: 'line', kind: 'declined', lang: r.lang, text: m.text, textEn: m.textEn });
    const channel: Channel = r.channel === 'sms' ? 'sms' : 'whatsapp';
    await recordNotification(ctx.db, { requestId: r.id, channel, lang: r.lang, messageKey: 'declined_with_appeal', text: m.text, status: 'sent' });
    ctx.bus.emit({ type: 'notify.sent', at: nowIso(), requestId: r.id, lang: r.lang, text: m.text, channel }, [r.id]);
    return { status: 'declined' as RequestStatus, message: { ...m, lang: r.lang } };
  }

  async previewDecline(input: { requestId: string; reasonCode: DeclineReasonCode; note?: string }) {
    const r = await this.loadReq(await this.base(), input.requestId);
    return { ...tpl.declined(r.lang, input.reasonCode, input.note), lang: r.lang };
  }

  async cancelPayoutItem(input: { batchId: string; itemId: string }) {
    const ctx = await this.ctx();
    const item = await ctx.approvals.cancelUnclaimed({ db: ctx.db, group: ctx.gen.group, bus: ctx.bus }, input);
    const { approvals: _a, ...base } = ctx;
    await applyItemStatus(base, { senderItemId: item.senderItemId, status: 'CANCELED', actor: 'organizer' });
    return { status: 'CANCELED' };
  }

  private async loadReq(ctx: BaseCtx, id: string): Promise<HelpRequest> {
    const r = await getRequest(ctx.db, id);
    if (!r || r.groupId !== ctx.gen.group.id) throw new HttpError(404, `No request ${id}`);
    return r;
  }

  /* ---------------- PayPal ---------------- */

  async handlePaypalWebhook(input: { headers: Record<string, string>; rawBody: string }) {
    return handleWebhook(await this.base(), input);
  }

  async reconcile() {
    const st = await this.state;
    return runReconcile(st.ctx, st.reconcile);
  }

  async getLedger() {
    const st = await this.state;
    return buildLedger(st.ctx, st.reconcile);
  }

  /* ---------------- donors ---------------- */

  async createDonationOrder(input: { amountCents: number; source: DonationSource }) {
    const st = await this.state;
    return donations.createDonationOrder(st.ctx, st.donations, input);
  }

  async captureDonationOrder(orderId: string) {
    const st = await this.state;
    return donations.captureDonationOrder(st.ctx, st.donations, orderId);
  }

  async getSubscriptionPlan(input: { amountCents: number }) {
    const st = await this.state;
    return donations.getSubscriptionPlan(st.ctx, st.donations, input);
  }

  async recordSubscription(input: { subscriptionId: string; amountCents: number }) {
    return donations.recordSubscription(await this.base(), input);
  }

  /* ---------------- transparency ---------------- */

  async getReport() {
    return buildReportView(await this.base());
  }

  async getTrust() {
    const ctx = await this.base();
    return buildTrust(ctx, await groupView(ctx));
  }

  /* ---------------- live events ---------------- */

  subscribe(listener: (msg: StreamMessage) => void) {
    return this.bus.subscribe(listener);
  }

  replay(requestId: string) {
    return this.bus.replay(requestId);
  }

  /* ---------------- demo stage ---------------- */

  async playScenario(input: { scenario: ScenarioId; mode: PlayMode; speed?: number }) {
    const st = await this.state;
    st.ctx.meta.prune();
    return playScenario(
      {
        services: this,
        startDemoIntake: async (id, channel, lang) => {
          await createRequest(st.ctx.db, { id, groupId: st.ctx.gen.group.id, channel, lang });
          this.bus.emit({ type: 'request.created', at: nowIso(), requestId: id, lang, channel }, [id]);
        },
        submitSampleInto: (id, sample, bubbleId) => intake.submitAudio(this.baseOf(st), id, { sampleId: sample }, { voiceMessageId: bubbleId }),
        onReset: (fn) => st.cleanups.add(fn),
      },
      st.ctx,
      input,
    );
  }

  private baseOf(st: GenState): BaseCtx {
    const { approvals: _a, ...base } = st.ctx;
    return base;
  }

  /**
   * Fresh database generation (the audit log is append-only, so we never delete rows). Requests in
   * flight finish against the old generation; new ones see the new one. Concurrent resets coalesce.
   */
  async resetDemo() {
    if (this.resetting) return this.resetting;
    this.resetting = (async () => {
      const old = await this.state;
      let gen: DbGeneration;
      try {
        gen = await openGeneration(this.cfg, old.ctx.gen.gen + 1, { fresh: true });
      } catch (err) {
        throw new HttpError(409, err instanceof Error ? err.message : 'Reset failed');
      }
      if (this.fake) await this.fake.reset().catch(() => {});
      this.state = Promise.resolve(this.makeState(gen));
      old.dead = true;
      for (const t of old.timers) clearTimeout(t);
      for (const c of old.cleanups) c();
      this.bus.clear();
      retireGeneration(old.ctx.gen);
    })().finally(() => {
      this.resetting = null;
    });
    return this.resetting;
  }
}
