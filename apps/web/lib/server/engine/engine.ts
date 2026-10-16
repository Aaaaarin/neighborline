/**
 * The real engine behind the `Services` seam: @neighborline/core (amounts, rail, approvals, state,
 * i18n, report) + @neighborline/db (PGlite / Postgres) + @neighborline/paypal (fake or sandbox) +
 * @neighborline/agents (fixture or live). Payouts go only through lib/server/approval-service.ts.
 */
import type { Channel, HelpRequest, Lang, PayoutItemStatus, RequestStatus } from '@neighborline/core';
import { InvalidTransitionError } from '@neighborline/core';
import { createAgents, type Agents } from '@neighborline/agents';
import { createRequest, getRequest, listItemsForRequest, listOrganizers, recordNotification, updateRequest } from '@neighborline/db';
import type {
  ApprovalResult,
  ApproveInput,
  OrganizerSession,
  PasskeyAssertionJSON,
  PolicySignInput,
  DeclineReasonCode,
  DonationSource,
  PlayMode,
  RuntimeModes,
  ScenarioId,
  StreamMessage,
} from '../../types';
import { ApprovalService, type SentBatch } from '../approval-service';
import { sweepAudio } from '../audio-retention';
import { HttpError } from '../errors';
import { errorText, log } from '../log';
import * as tpl from '../fixtures/templates';
import { SAMPLE_VOICE_NOTES } from '../fixtures/scenarios';
import { FakePayPalControl, createPublicPayPal, type PublicPayPal } from '../paypal';
import type { AudioInput, InternalOps, Services } from '../services';
import type { BaseCtx, Ctx } from './context';
import { openGeneration, retireGeneration, type DbGeneration } from './db-state';
import * as donations from './donations';
import * as internal from './internal';
import { readConfig, type EngineConfig, type Env } from './env';
import { EventBus, nowIso } from './events';
import * as intake from './intake';
import * as passkeys from './passkeys';
import * as policyEditor from './policy-editor';
import { splitFrom } from '../../../components/stage/stage-steps';
import { buildLedger, runReconcile, type ReconcileCache } from './ledger';
import { MetaStore } from './meta';
import { buildTrust } from './report';
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
  report: internal.ReportStore;
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
    // Retained recordings (AUDIO_RETENTION=24h) expire even across restarts.
    sweepAudio(this.cfg.audio);
    setInterval(() => sweepAudio(this.cfg.audio), 3_600_000).unref?.();
    this.state.catch((err) => log.error('engine.db_boot_failed', { error: errorText(err) }));
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
      report: { latest: null },
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
      verifyPayoutsWebhook: (input) => this.approvals.approver.verifyPayoutsWebhook(input),
      bus: this.bus,
      meta: new MetaStore(),
      later: (ms, fn, speed = 1) => {
        if (st.dead) return;
        const t = setTimeout(() => {
          st.timers.delete(t);
          if (st.dead) return;
          Promise.resolve()
            .then(fn)
            .catch((err) => log.warn('engine.scheduled_step_failed', { error: errorText(err) }));
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

  async approve(input: ApproveInput & { origin?: string | null }): Promise<ApprovalResult> {
    const ctx = await this.ctx();
    // Verify the tap's signature over the approval hash and store it first (passkeys.ts); the
    // approver identity comes from the credential, never from the request body.
    const signed = await passkeys.signTap(ctx, { ...input, origin: input.origin ?? null });
    const deviceLabel = signed.assertion.deviceLabel;
    const { sent, ...result } = await ctx.approvals.approve(
      { db: ctx.db, group: ctx.gen.group, bus: ctx.bus },
      { requestIds: input.requestIds, organizerId: signed.organizerId, deviceLabel },
    );
    if (sent) await this.afterSent(ctx, sent);
    return { ...result, signer: { organizerId: signed.organizerId, kind: signed.assertion.kind, deviceLabel } };
  }

  /* ---------------- organizer passkeys ---------------- */

  async passkeyRoster() {
    return passkeys.roster(await this.base());
  }

  async passkeyRegistrationOptions(input: { organizerId: string; origin: string | null; inviteCode?: string; session: OrganizerSession | null }) {
    return passkeys.registrationOptions(await this.base(), input);
  }

  async passkeyRegister(input: { organizerId: string; origin: string | null; response: unknown; deviceLabel: string; inviteCode?: string; session: OrganizerSession | null }) {
    return passkeys.register(await this.base(), input as Parameters<typeof passkeys.register>[1]);
  }

  async passkeySignInOptions(input: { origin: string | null }) {
    return passkeys.signInOptions(await this.base(), input);
  }

  async passkeySignIn(input: { response: PasskeyAssertionJSON }) {
    return passkeys.signIn(await this.base(), input);
  }

  async approvalChallenge(input: { requestIds: string[]; origin: string | null; organizerId?: string; credentialIds?: string[] }) {
    return passkeys.approvalChallenge(await this.base(), input);
  }

  async liveSession(session: OrganizerSession | null) {
    return passkeys.liveSession(await this.base(), session);
  }

  async revokePasskey(input: { credentialId: string; session: OrganizerSession | null }) {
    return passkeys.revokePasskey(await this.base(), input);
  }

  /* ---------------- rules editor (policy versions) ---------------- */

  async policyEditor() {
    return policyEditor.editorView(await this.base());
  }

  /** Drafting needs a signed-in organizer (a live passkey session), except in DEMO_MODE. */
  async compilePolicy(input: { sourceText: string; session: OrganizerSession | null }) {
    const ctx = await this.base();
    const actor = await passkeys.liveSession(ctx, input.session);
    if (!actor && this.env.DEMO_MODE === 'false') throw new HttpError(401, 'Sign in with your passkey to draft new rules.');
    return policyEditor.compileDraft(ctx, { sourceText: input.sourceText, actor });
  }

  async policyChallenge(input: { draftHash: string; origin: string | null; organizerId?: string }) {
    return policyEditor.policyChallenge(await this.base(), input);
  }

  async signPolicy(input: PolicySignInput & { origin?: string | null }) {
    return policyEditor.signDraft(await this.base(), { ...input, origin: input.origin ?? null });
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
    if (ctx.cfg.paypalMode === 'sandbox' && sent.batch.paypalBatchId) this.pollBatch(ctx, sent.batch.id);
  }

  /**
   * Webhook safety net / localhost fallback: GET the batch at growing intervals and apply item
   * statuses through the same idempotent path as webhooks (a status applied twice is a no-op).
   */
  private pollBatch(ctx: Ctx, batchId: string) {
    const schedule = [5_000, 15_000, 45_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000];
    const { approvals: _a, ...base } = ctx;
    const tick = (i: number) => {
      ctx.later(schedule[i]!, async () => {
        const items = await this.approvals.pollBatch(batchId);
        let open = false;
        for (const it of items) {
          if (it.status === 'PENDING' || it.status === 'ONHOLD' || it.status === 'UNCLAIMED') open = true;
          if (it.status === 'PENDING') continue;
          await applyItemStatus(base, { paypalItemId: it.payoutItemId, ...(it.senderItemId ? { senderItemId: it.senderItemId } : {}), status: it.status as PayoutItemStatus, ...(it.transactionId ? { transactionId: it.transactionId } : {}), actor: 'paypal-poll' });
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
    const meta = ctx.meta.ensure(r.id);
    // Idempotent: a second tap, or a second organizer, gets the decision that was already sent. No second message.
    const already = () => {
      const d = meta.decline ?? { reasonCode: input.reasonCode, note: input.note };
      return { status: 'declined' as RequestStatus, message: { ...tpl.declined(r.lang, d.reasonCode, d.note, { final: !!meta.appeal }), lang: r.lang }, alreadyDeclined: true };
    };
    if (r.status === 'declined') return already();
    if ((await listItemsForRequest(ctx.db, r.id)).length) throw new HttpError(409, 'Already sent to PayPal; it can no longer be declined.');
    const appeal = meta.appeal && !meta.appeal.closed ? meta.appeal : null;
    if (appeal && appeal.firstDecline.organizerId === org.id) {
      throw new HttpError(409, 'You declined this request the first time, and the neighbor asked for a different organizer to look again.');
    }
    try {
      await updateRequest(ctx.db, r.id, { status: 'declined' }, { actor: org.id });
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        if ((await this.loadReq(ctx, r.id)).status === 'declined') return already();
        throw new HttpError(409, `This request is ${r.status.replace('_', ' ')} and can’t be declined.`);
      }
      throw err;
    }
    const m = tpl.declined(r.lang, input.reasonCode, input.note, { final: !!appeal });
    meta.decline = { organizerId: org.id, reasonCode: input.reasonCode, ...(input.note ? { note: input.note } : {}), at: nowIso() };
    if (appeal) appeal.closed = true;
    ctx.meta.message(r.id, { from: 'line', kind: 'declined', lang: r.lang, text: m.text, textEn: m.textEn });
    const channel: Channel = r.channel === 'sms' ? 'sms' : 'whatsapp';
    await recordNotification(ctx.db, { requestId: r.id, channel, lang: r.lang, messageKey: 'declined_with_appeal', text: m.text, status: 'sent' });
    ctx.bus.emit({ type: 'notify.sent', at: nowIso(), requestId: r.id, lang: r.lang, text: m.text, channel }, [r.id]);
    return { status: 'declined' as RequestStatus, message: { ...m, lang: r.lang } };
  }

  async previewDecline(input: { requestId: string; reasonCode: DeclineReasonCode; note?: string }) {
    const ctx = await this.base();
    const r = await this.loadReq(ctx, input.requestId);
    const appeal = ctx.meta.get(r.id)?.appeal;
    return { ...tpl.declined(r.lang, input.reasonCode, input.note, { final: !!appeal && !appeal.closed }), lang: r.lang };
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
    const st = await this.state;
    return internal.currentReport(this.baseOf(st), st.report);
  }

  /* ---------------- background jobs (POST /api/internal/*, Render Workflows) ---------------- */

  readonly internal: InternalOps = {
    reconcileWindow: async (req) => {
      const st = await this.state;
      return internal.reconcileWindow(this.baseOf(st), st.reconcile, req);
    },
    unclaimedSweep: async (req) => internal.unclaimedSweep(await this.base(), req),
    renotify: async (req) => internal.renotifyUnclaimed(await this.base(), req),
    organizerAlert: async (req) => internal.organizerAlert(await this.base(), req),
    reportRefresh: async (req) => {
      const st = await this.state;
      return internal.reportRefresh(this.baseOf(st), st.report, req);
    },
  };

  /** For GET /api/health: is the approver process up (no secrets involved)? */
  async approverUp(): Promise<boolean> {
    return (await this.approvals.approver.health(1500)) !== null;
  }

  async getTrust() {
    const ctx = await this.base();
    return buildTrust(ctx, await groupView(ctx), await this.approvals.approver.health());
  }

  /* ---------------- live events ---------------- */

  subscribe(listener: (msg: StreamMessage) => void) {
    return this.bus.subscribe(listener);
  }

  replay(requestId: string) {
    return this.bus.replay(requestId);
  }

  lastRunSpeed() {
    const events = this.bus.latestPaid();
    return events ? splitFrom(events.map((event) => ({ event, at: Date.parse(event.at) })), Date.now()) : null;
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
