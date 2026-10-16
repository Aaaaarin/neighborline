/**
 * In-memory mock of the whole Neighborline flow: intake → read-back → two approvals →
 * Payouts batch → webhook → notify. Emits the same StageEvents the real system will.
 * Replace with real packages via lib/server/services.ts (see INTEGRATION.md).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { HelpRequest, Lang, PayoutBatch, PayoutItem, PayoutItemStatus, RequestStatus, StageEvent } from '@neighborline/core';
import type {
  ApprovalChallenge,
  CompilePolicyOutcome,
  PolicyEditorView,
  PolicySignResult,
  ApprovalResult,
  ApproveInput,
  OrganizerSession,
  PasskeyRoster,
  DeclineReasonCode,
  DonationCapture,
  DonationOrder,
  DonationSource,
  IntakeResult,
  LedgerView,
  PlayMode,
  ReconcileResult,
  ReportView,
  RequestView,
  RuntimeModes,
  ScenarioId,
  ScenarioRun,
  StreamMessage,
  SubscriptionPlan,
  ThreadMessage,
  ThreadView,
  TrustView,
} from '../types';
import { ORGANIZERS, POLICY, categoryLabel, groupView } from './fixtures/group';
import { SAMPLE_VOICE_NOTES, SCENARIOS, type ScenarioOutcome, type ScenarioScript, scenarioForLang } from './fixtures/scenarios';
import * as tpl from './fixtures/templates';
import { computeAmount, railCheck } from './mock-rail';
import { buildLedger, buildReport, buildTrust } from './mock-report';
import { extractFromText } from './mock-text-intake';
import { HISTORY_DONATIONS, buildHistory, type HistoryDecision, type HistoryPayout } from './seed';
import type { AudioInput, Services } from './services';
import { HttpError } from './errors';
import { runScenario } from './mock-scenario-runner';

export interface Rec {
  request: HelpRequest;
  requester: { displayName: string; area?: string };
  audioSeconds?: number;
  approvals: RequestView['approvals'];
  breakdown: RequestView['amountBreakdown'];
  batchId?: string;
  itemId?: string;
  decline?: RequestView['decline'];
  thread: ThreadMessage[];
  scenario?: ScenarioId;
  outcome: ScenarioOutcome;
  speed: number;
  confirmedAtMs?: number;
  paidAtMs?: number;
}

const now = () => new Date().toISOString();
const rid = (p: string) => `${p}_${randomBytes(5).toString('hex')}`;
const upper = (n: number) => randomBytes(n).toString('hex').toUpperCase().slice(0, n);
const money = (c: number) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

export class MockEngine implements Services {
  readonly modes: RuntimeModes = {
    paypalMode: (process.env.PAYPAL_MODE as RuntimeModes['paypalMode']) === 'sandbox' ? 'sandbox' : 'mock',
    aiMode: process.env.AI_MODE === 'live' ? 'live' : 'fixture',
    engine: 'mock',
  };

  recs = new Map<string, Rec>();
  batches = new Map<string, PayoutBatch>();
  items = new Map<string, PayoutItem>();
  history: HistoryPayout[] = [];
  decisions: HistoryDecision[] = [];
  donations = { cents: HISTORY_DONATIONS.cents, donors: HISTORY_DONATIONS.donors };
  orders = new Map<string, { amountCents: number; source: DonationSource; captured: boolean }>();
  lastReconciledAt: string | null = null;
  reconciled = new Set<string>();
  private log: StreamMessage[] = [];
  private listeners = new Set<(m: StreamMessage) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private runs = 0;

  constructor() {
    this.seed();
  }

  /* ---------------- plumbing ---------------- */

  private seed() {
    const h = buildHistory();
    this.history = h.payouts;
    this.decisions = h.decisions;
    this.lastReconciledAt = new Date(Date.UTC(2026, 9, 16, 9, 0)).toISOString();
    for (const p of this.history) if (p.status === 'SUCCESS') this.reconciled.add(p.itemId);
    this.seedQueue();
  }

  /** Two requests already waiting so /organizer is never empty. */
  private seedQueue() {
    const minh = this.newRec({ channel: 'whatsapp', lang: 'vi', displayName: 'Minh', area: 'Montavilla' });
    this.applyIntake(minh, {
      original: 'Tủ lạnh hư vì mất điện, đồ ăn hỏng hết. Nhà 3 người. Xin giúp $80 mua đồ ăn. Venmo @minh-tran-88.',
      english: 'Fridge died in the outage and all the food spoiled. 3 people at home. Asking for $80 for groceries. Venmo @minh-tran-88.',
      summaryEn: 'Food spoiled after the outage. Household of 3. Asks $80 for groceries.',
      category: 'groceries',
      requestedCents: 8_000,
      payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@minh-tran-88' },
      householdSize: 3,
    });
    minh.request.status = 'awaiting_approval';
    minh.request.confirmedByRequester = true;
    minh.approvals.push({ organizerId: 'org_priya', name: 'Priya', at: now() });

    const ana = this.newRec({ channel: 'sms', lang: 'es', displayName: 'Ana', area: 'Brentwood-Darlington' });
    this.applyIntake(ana, {
      original: 'Se fue la luz y la calefacción es eléctrica. Tengo un bebé. Necesito para un calentador. PayPal ana.r.lopez@example.com',
      english: 'The power went out and the heat is electric. I have a baby. I need money for a heater. PayPal ana.r.lopez@example.com',
      summaryEn: 'Power out, electric heat, has a baby. Needs a space heater.',
      category: 'utility_outage',
      payout: { wallet: 'PAYPAL', type: 'EMAIL', value: 'ana.r.lopez@example.com' },
      householdSize: 2,
    });
    ana.request.railFlags.push({
      code: 'DUP_DESTINATION_DIFF_NAME',
      severity: 'review',
      detail: 'This PayPal email received a payout 9 days ago under a different first name. Could be family — worth a quick call.',
    });
    ana.request.status = 'awaiting_approval';
    ana.request.confirmedByRequester = true;
  }

  /** @internal */
  emit(event: StageEvent, requestIds: string[]) {
    const msg: StreamMessage = { kind: 'stage', event, requestIds };
    this.log.push(msg);
    if (this.log.length > 3000) this.log.splice(0, this.log.length - 3000);
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch {
        /* a broken SSE client must not break the engine */
      }
    }
  }

  /** @internal */
  later(rec: Rec | null, ms: number, fn: () => void) {
    const speed = rec?.speed ?? 1;
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, Math.max(0, ms / speed));
    this.timers.add(t);
  }

  subscribe(listener: (msg: StreamMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replay(requestId: string) {
    return this.log.filter((m) => m.kind === 'stage' && m.requestIds.includes(requestId));
  }

  /** @internal */
  rec(id: string): Rec {
    const r = this.recs.get(id);
    if (!r) throw new HttpError(404, `No request ${id}`);
    return r;
  }

  /** @internal */
  newRec(input: { channel: HelpRequest['channel']; lang: Lang; displayName: string; area?: string; speed?: number }): Rec {
    const id = `req_${randomBytes(5).toString('hex')}`;
    const rec: Rec = {
      request: {
        id,
        groupId: 'grp_eastside',
        createdAt: now(),
        channel: input.channel,
        lang: input.lang,
        originalText: '',
        englishText: '',
        photoRefs: [],
        extracted: null,
        confirmedByRequester: false,
        payoutDestination: null,
        status: 'intake',
        policyVersionId: POLICY.id,
        computed: null,
        railFlags: [],
      },
      requester: { displayName: input.displayName, area: input.area },
      approvals: [],
      breakdown: null,
      thread: [],
      outcome: 'success',
      speed: input.speed ?? 1,
    };
    this.recs.set(id, rec);
    return rec;
  }

  /** @internal */
  msg(rec: Rec, m: Omit<ThreadMessage, 'id' | 'at'>) {
    const full: ThreadMessage = { id: rid('m'), at: now(), ...m };
    rec.thread.push(full);
    return full;
  }

  /** Fill extraction, computed amount and rail flags. Code computes the amount, never the AI. */
  private applyIntake(
    rec: Rec,
    x: {
      original: string;
      english: string;
      summaryEn: string;
      summaryNative?: string;
      category: string;
      requestedCents?: number;
      payout?: HelpRequest['payoutDestination'];
      householdSize?: number;
      confidence?: number;
      items?: string[];
    },
  ) {
    const r = rec.request;
    r.originalText = x.original;
    r.englishText = x.english;
    r.extracted = {
      lang: r.lang,
      summaryEn: x.summaryEn,
      summaryNative: x.summaryNative ?? x.original.slice(0, 600),
      category: x.category,
      householdSize: x.householdSize,
      urgency: 'today',
      requestedItems: x.items ?? [],
      requestedAmountCents: x.requestedCents,
      payout: x.payout ? { wallet: x.payout.wallet, type: x.payout.type, value: x.payout.value } : undefined,
      missing: x.payout ? [] : ['payout'],
      confidence: x.confidence ?? 0.9,
    };
    r.payoutDestination = x.payout ?? null;
    const amount = computeAmount({
      categoryKey: x.category,
      requestedCents: x.requestedCents,
      householdPaid30dCents: 0,
      paidTodayCents: this.paidTodayCents(),
    });
    r.computed = amount
      ? { amountCents: amount.amountCents, ruleKey: x.category, ruleCitation: amount.citation, policyVersion: POLICY.version }
      : null;
    rec.breakdown = amount?.breakdown ?? null;
    r.railFlags = railCheck({
      text: x.original,
      destination: r.payoutDestination,
      requestedCents: x.requestedCents,
      categoryKey: x.category,
    });
  }

  private paidTodayCents() {
    let sum = 0;
    for (const i of this.items.values()) if (i.status === 'SUCCESS' || i.status === 'PENDING') sum += i.amountCents;
    return 76_000 + sum; // $760 already paid today in the seeded story
  }

  /* ---------------- intake ---------------- */

  async startIntake(input: { groupSlug: string; channel: HelpRequest['channel']; lang?: Lang }) {
    const rec = this.newRec({ channel: input.channel, lang: input.lang ?? 'en', displayName: 'Neighbor', area: 'via web' });
    this.emit({ type: 'request.created', at: now(), requestId: rec.request.id, lang: rec.request.lang, channel: rec.request.channel }, [rec.request.id]);
    return { requestId: rec.request.id };
  }

  /** @internal */
  applyScript(rec: Rec, s: ScenarioScript) {
    rec.request.lang = s.lang;
    rec.audioSeconds = s.audioSeconds;
    rec.outcome = s.outcome;
    this.applyIntake(rec, {
      original: s.transcript,
      english: s.transcriptEn,
      summaryEn: s.extraction.summaryEn,
      summaryNative: s.extraction.summaryNative,
      category: s.extraction.category,
      requestedCents: s.extraction.requestedAmountCents,
      payout: s.payout,
      householdSize: s.extraction.householdSize,
      confidence: s.extraction.confidence,
      items: s.extraction.requestedItems,
    });
  }

  private intakeResult(rec: Rec, readBack: { text: string; textEn: string }, simulated: boolean): IntakeResult {
    const r = rec.request;
    return {
      requestId: r.id,
      status: r.status,
      transcript: { text: r.originalText, lang: r.lang, textEn: r.englishText },
      readBack: { ...readBack, lang: r.lang },
      extraction: r.extracted!,
      missing: r.extracted?.missing ?? [],
      simulatedTranscript: simulated,
    };
  }

  async submitAudio(requestId: string, input: AudioInput): Promise<IntakeResult> {
    const rec = this.rec(requestId);
    const script = input.sampleId ? SCENARIOS[input.sampleId] : scenarioForLang(input.lang);
    this.applyScript(rec, script);
    this.msg(rec, { from: 'neighbor', kind: 'voice', lang: script.lang, text: script.transcript, textEn: script.transcriptEn, meta: { audioSeconds: script.audioSeconds } });
    if (input.photo) this.msg(rec, { from: 'neighbor', kind: 'photo', lang: script.lang, text: 'Photo' });
    this.emit({ type: 'request.transcribed', at: now(), requestId, text: script.transcript, lang: script.lang }, [requestId]);
    this.msg(rec, { from: 'line', kind: 'readback', lang: script.lang, text: script.readback, textEn: script.readbackEn });
    this.emit({ type: 'request.readback', at: now(), requestId, text: script.readback, lang: script.lang }, [requestId]);
    return this.intakeResult(rec, { text: script.readback, textEn: script.readbackEn }, !input.sampleId);
  }

  async submitText(requestId: string, input: { text: string; lang?: Lang }): Promise<IntakeResult> {
    const rec = this.rec(requestId);
    const lang = input.lang ?? rec.request.lang;
    rec.request.lang = lang;
    this.msg(rec, { from: 'neighbor', kind: 'text', lang, text: input.text });
    const prev = rec.request.extracted;
    const x = extractFromText(input.text, lang, prev);
    this.applyIntake(rec, {
      original: prev ? `${rec.request.originalText}\n${input.text}` : input.text,
      english: x.english,
      summaryEn: x.summary,
      category: x.category,
      requestedCents: x.requestedCents,
      payout: x.payout,
    });
    rec.request.status = 'intake';
    this.emit({ type: 'request.transcribed', at: now(), requestId, text: input.text, lang }, [requestId]);
    const cat = POLICY.categories.find((c) => c.key === x.category);
    const rb = x.payout || !prev
      ? tpl.genericReadback(lang, {
          summary: x.summaryNative,
          categoryLabel: categoryLabel(x.category, lang),
          cap: money(cat?.maxCents ?? 0),
          payout: x.payout ? `${x.payout.wallet === 'VENMO' ? 'Venmo' : 'PayPal'} ${x.payout.value}` : undefined,
        })
      : tpl.needsPayout(lang);
    this.msg(rec, { from: 'line', kind: 'readback', lang, text: rb.text, textEn: rb.textEn });
    this.emit({ type: 'request.readback', at: now(), requestId, text: rb.text, lang }, [requestId]);
    return this.intakeResult(rec, rb, true);
  }

  async confirmIntake(requestId: string, input: { confirmed: boolean; corrections?: string }) {
    const rec = this.rec(requestId);
    const r = rec.request;
    if (!input.confirmed) {
      if (input.corrections) await this.submitText(requestId, { text: input.corrections });
      else r.status = 'needs_clarification';
      return { status: r.status, thread: (await this.getThread(requestId))! };
    }
    const qr = tpl.quickReplies(r.lang);
    this.msg(rec, { from: 'neighbor', kind: 'text', lang: r.lang, text: qr.yes, textEn: 'Yes, that’s right' });
    r.confirmedByRequester = true;
    rec.confirmedAtMs = Date.now();
    if (!r.payoutDestination) {
      r.status = 'needs_clarification';
      const q = tpl.needsPayout(r.lang);
      this.msg(rec, { from: 'line', kind: 'status', lang: r.lang, text: q.text, textEn: q.textEn });
    } else {
      r.status = 'awaiting_approval';
      const a = tpl.ack(r.lang);
      this.msg(rec, { from: 'line', kind: 'ack', lang: r.lang, text: a.text, textEn: a.textEn });
    }
    this.emit({ type: 'request.confirmed', at: now(), requestId }, [requestId]);
    if (r.railFlags.length) this.emit({ type: 'request.flagged', at: now(), requestId, flags: r.railFlags }, [requestId]);
    return { status: r.status, thread: (await this.getThread(requestId))! };
  }

  async getThread(requestId: string): Promise<ThreadView | null> {
    const rec = this.recs.get(requestId);
    if (!rec) return null;
    const item = rec.itemId ? this.items.get(rec.itemId) : undefined;
    return {
      requestId,
      lang: rec.request.lang,
      status: rec.request.status,
      itemStatus: item?.status ?? null,
      awaitingConfirmation: rec.request.status === 'intake' && !!rec.request.extracted && rec.outcome !== 'blocked',
      messages: rec.thread,
      approvalsCount: rec.approvals.length,
      approvalsRequired: POLICY.approvalsRequired,
    };
  }

  listSampleVoiceNotes() {
    return SAMPLE_VOICE_NOTES;
  }

  /* ---------------- organizers ---------------- */

  async getGroup() {
    return groupView(this.modes.paypalMode !== 'sandbox');
  }

  toView(rec: Rec): RequestView {
    const batch = rec.batchId ? this.batches.get(rec.batchId) : undefined;
    const item = rec.itemId ? this.items.get(rec.itemId) : undefined;
    return {
      request: rec.request,
      requester: rec.requester,
      categoryLabel: categoryLabel(rec.request.extracted?.category ?? 'other'),
      audioSeconds: rec.audioSeconds,
      approvals: rec.approvals,
      approvalsRequired: POLICY.approvalsRequired,
      amountBreakdown: rec.breakdown,
      payout: batch && item ? { batch, item } : null,
      decline: rec.decline,
      aiTrace: rec.request.extracted
        ? rec.scenario === 'walter'
          ? { status: 'repaired', summary: 'Schema repaired 1 field (payout.value) · 1 repair call · fixture' }
          : { status: 'valid', summary: `IntakeExtraction valid on first try · confidence ${rec.request.extracted.confidence.toFixed(2)} · fixture` }
        : undefined,
    };
  }

  async listRequests(filter?: { status?: RequestStatus[] }) {
    const all = [...this.recs.values()].filter((r) => r.request.extracted);
    const list = filter?.status?.length ? all.filter((r) => filter.status!.includes(r.request.status)) : all;
    return list.sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt)).map((r) => this.toView(r));
  }

  async getRequest(id: string) {
    const rec = this.recs.get(id);
    return rec ? this.toView(rec) : null;
  }

  /* Passkeys need the real engine (database-backed credentials). The mock only knows demo keys. */
  async passkeyRoster(): Promise<PasskeyRoster> {
    return { demoMode: true, inviteRequired: false, organizers: ORGANIZERS.map((o) => ({ id: o.id, name: o.name, passkeys: [] })) };
  }
  async passkeyRegistrationOptions(): Promise<{ optionsJSON: unknown }> {
    throw new HttpError(501, 'Passkeys need the real engine (unset ENGINE=mock).');
  }
  async passkeyRegister(): Promise<OrganizerSession> {
    throw new HttpError(501, 'Passkeys need the real engine (unset ENGINE=mock).');
  }
  async passkeySignInOptions(): Promise<{ optionsJSON: unknown }> {
    throw new HttpError(501, 'Passkeys need the real engine (unset ENGINE=mock).');
  }
  async passkeySignIn(): Promise<OrganizerSession> {
    throw new HttpError(501, 'Passkeys need the real engine (unset ENGINE=mock).');
  }
  lastRunSpeed() {
    return null;
  }
  async approvalChallenge(): Promise<ApprovalChallenge> {
    throw new HttpError(501, 'Passkeys need the real engine (unset ENGINE=mock).');
  }
  async liveSession(): Promise<OrganizerSession | null> {
    return null;
  }
  async revokePasskey(): Promise<{ organizerId: string; deviceLabel: string; signedOut: boolean }> {
    throw new HttpError(501, 'Passkeys need the real engine (unset ENGINE=mock).');
  }
  /* The rules editor needs the real engine (policy versions live in the database). */
  async policyEditor(): Promise<PolicyEditorView> {
    throw new HttpError(501, 'The rules editor needs the real engine (unset ENGINE=mock).');
  }
  async compilePolicy(): Promise<CompilePolicyOutcome> {
    throw new HttpError(501, 'The rules editor needs the real engine (unset ENGINE=mock).');
  }
  async policyChallenge(): Promise<ApprovalChallenge> {
    throw new HttpError(501, 'The rules editor needs the real engine (unset ENGINE=mock).');
  }
  async signPolicy(): Promise<PolicySignResult> {
    throw new HttpError(501, 'The rules editor needs the real engine (unset ENGINE=mock).');
  }

  async approve(input: ApproveInput): Promise<ApprovalResult> {
    if (input.signer.kind !== 'demo_key') throw new HttpError(501, 'Passkeys need the real engine (unset ENGINE=mock).');
    const org = ORGANIZERS.find((o) => o.id === input.organizerId);
    if (!org) throw new HttpError(403, 'Unknown organizer');
    const recs = input.requestIds.map((id) => this.rec(id));
    for (const rec of recs) {
      const block = rec.request.railFlags.find((f) => f.severity === 'block');
      if (block) throw new HttpError(409, `Blocked by rail protection: ${block.detail}`);
      if (!rec.request.computed || !rec.request.payoutDestination) throw new HttpError(409, 'Request is not ready for approval');
    }
    const approvalId = `ap_${hash(input.requestIds.slice().sort()).slice(0, 12)}`;
    const first = recs[0]!;
    // Idempotent: a second tap, or a tap after execution, returns the existing state.
    if (first.batchId || first.request.status !== 'awaiting_approval') {
      const b = first.batchId ? this.batches.get(first.batchId) : undefined;
      return { approvalId, count: first.approvals.length, required: POLICY.approvalsRequired, executed: !!b, batchId: b?.id, senderBatchId: b?.senderBatchId };
    }
    if (!first.approvals.some((a) => a.organizerId === org.id)) {
      for (const rec of recs) rec.approvals.push({ organizerId: org.id, name: org.name, at: now() });
      this.emit({ type: 'approval.added', at: now(), approvalId, organizerId: org.id, count: first.approvals.length }, input.requestIds);
    }
    if (first.approvals.length >= POLICY.approvalsRequired) {
      const b = this.executePayout(recs, approvalId);
      return { approvalId, count: first.approvals.length, required: POLICY.approvalsRequired, executed: true, batchId: b.id, senderBatchId: b.senderBatchId };
    }
    return { approvalId, count: first.approvals.length, required: POLICY.approvalsRequired, executed: false };
  }

  private executePayout(recs: Rec[], approvalId: string): PayoutBatch {
    const canonical = recs
      .map((r) => ({ id: r.request.id, cents: r.request.computed!.amountCents, dest: r.request.payoutDestination }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const senderBatchId = `nl_${hash({ canonical, policy: POLICY.id }).slice(0, 24)}`;
    const existing = [...this.batches.values()].find((b) => b.senderBatchId === senderBatchId);
    if (existing) return existing;
    const batch: PayoutBatch = { id: rid('pb'), approvalId, senderBatchId, paypalBatchId: upper(13), status: 'PENDING', createdAt: now() };
    this.batches.set(batch.id, batch);
    let total = 0;
    for (const rec of recs) {
      const r = rec.request;
      const dest = r.payoutDestination!;
      const item: PayoutItem = {
        id: rid('pi'),
        batchId: batch.id,
        requestId: r.id,
        senderItemId: `${senderBatchId}_${r.id.slice(-6)}`,
        paypalItemId: upper(13),
        amountCents: r.computed!.amountCents,
        wallet: dest.wallet,
        receiver: dest.value,
        recipientType: dest.type,
        status: 'PENDING',
        lastEventAt: now(),
      };
      total += item.amountCents;
      this.items.set(item.id, item);
      rec.batchId = batch.id;
      rec.itemId = item.id;
      r.status = 'paying';
      const s = tpl.sending(r.lang);
      this.msg(rec, { from: 'line', kind: 'status', lang: r.lang, text: s.text, textEn: s.textEn });
    }
    const ids = recs.map((r) => r.request.id);
    this.emit({ type: 'payout.batch_created', at: now(), batchId: batch.id, senderBatchId, paypalBatchId: batch.paypalBatchId, itemCount: recs.length, totalCents: total }, ids);
    for (const rec of recs) {
      const item = this.items.get(rec.itemId!)!;
      this.emit({ type: 'payout.item_updated', at: now(), itemId: item.id, requestId: rec.request.id, status: 'PENDING', paypalItemId: item.paypalItemId }, [rec.request.id]);
      this.scheduleSettlement(rec, item);
    }
    return batch;
  }

  /** What fake PayPal would do: webhook a few seconds after the batch. */
  private scheduleSettlement(rec: Rec, item: PayoutItem) {
    if (rec.outcome === 'unclaimed_then_success') {
      this.later(rec, 5200, () => this.webhookStatus(item.id, 'UNCLAIMED'));
      this.later(rec, 15_800, () => this.webhookStatus(item.id, 'SUCCESS'));
    } else {
      this.later(rec, 5200, () => this.webhookStatus(item.id, 'SUCCESS'));
    }
  }

  private webhookStatus(itemId: string, status: PayoutItemStatus) {
    const eventType = status === 'SUCCESS' ? 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' : `PAYMENT.PAYOUTS-ITEM.${status}`;
    const item = this.items.get(itemId);
    if (!item) return;
    this.emit({ type: 'webhook.verified', at: now(), eventType, eventId: `WH-${upper(17)}` }, [item.requestId]);
    const rec = this.recs.get(item.requestId);
    this.later(rec ?? null, 220, () => this.applyItemStatus(itemId, status));
  }

  private applyItemStatus(itemId: string, status: PayoutItemStatus, transactionId?: string) {
    const item = this.items.get(itemId);
    if (!item) return;
    const rec = this.recs.get(item.requestId);
    item.status = status;
    item.lastEventAt = now();
    if (status === 'SUCCESS') item.transactionId = transactionId ?? `${upper(2)}${upper(15)}`;
    this.emit(
      { type: 'payout.item_updated', at: now(), itemId, requestId: item.requestId, status, paypalItemId: item.paypalItemId, transactionId: item.transactionId },
      [item.requestId],
    );
    const batch = this.batches.get(item.batchId);
    if (batch && status === 'SUCCESS') batch.status = 'SUCCESS';
    if (!rec) return;
    const r = rec.request;
    const slots = { amount: money(item.amountCents), wallet: item.wallet, receiver: item.receiver, tx: item.transactionId };
    const wasUnclaimed = r.status === 'unclaimed';
    if (status === 'SUCCESS') {
      r.status = 'paid';
      rec.paidAtMs = Date.now();
    } else if (status === 'UNCLAIMED') r.status = 'unclaimed';
    else if (status === 'RETURNED') r.status = 'returned';
    else if (status === 'FAILED' || status === 'BLOCKED') r.status = 'failed';
    else if (status === 'CANCELED') r.status = 'cancelled';
    const note =
      status === 'SUCCESS'
        ? wasUnclaimed
          ? { kind: 'paid' as const, ...tpl.claimed(r.lang, slots) }
          : { kind: 'paid' as const, ...tpl.paid(r.lang, slots) }
        : status === 'UNCLAIMED'
          ? { kind: 'claim_help' as const, ...tpl.claimHelp(r.lang, slots) }
          : null;
    if (note) {
      this.later(rec, 1600, () => {
        this.msg(rec, {
          from: 'line',
          kind: note.kind,
          lang: r.lang,
          text: note.text,
          textEn: note.textEn,
          meta: { amountCents: item.amountCents, transactionId: item.transactionId, wallet: item.wallet, receiver: item.receiver, channel: 'whatsapp' },
        });
        this.emit({ type: 'notify.sent', at: now(), requestId: r.id, lang: r.lang, text: note.text, channel: 'whatsapp' }, [r.id]);
      });
    }
  }

  async previewDecline(input: { requestId: string; reasonCode: DeclineReasonCode; note?: string }) {
    const rec = this.rec(input.requestId);
    return { ...tpl.declined(rec.request.lang, input.reasonCode, input.note), lang: rec.request.lang };
  }

  async decline(input: { requestId: string; organizerId: string; reasonCode: DeclineReasonCode; note?: string }) {
    const rec = this.rec(input.requestId);
    if (!ORGANIZERS.some((o) => o.id === input.organizerId)) throw new HttpError(403, 'Unknown organizer');
    if (rec.batchId) throw new HttpError(409, 'Already sent to PayPal; it can no longer be declined.');
    const m = tpl.declined(rec.request.lang, input.reasonCode, input.note);
    rec.request.status = 'declined';
    rec.decline = { organizerId: input.organizerId, reasonCode: input.reasonCode, note: input.note, at: now() };
    this.msg(rec, { from: 'line', kind: 'declined', lang: rec.request.lang, text: m.text, textEn: m.textEn });
    this.emit({ type: 'notify.sent', at: now(), requestId: rec.request.id, lang: rec.request.lang, text: m.text, channel: 'whatsapp' }, [rec.request.id]);
    return { status: rec.request.status, message: { ...m, lang: rec.request.lang } };
  }

  async cancelPayoutItem(input: { batchId: string; itemId: string }) {
    const item = this.items.get(input.itemId);
    if (!item || item.batchId !== input.batchId) throw new HttpError(404, 'No such payout item');
    if (item.status !== 'UNCLAIMED') throw new HttpError(409, 'Only unclaimed items can be cancelled');
    this.applyItemStatus(item.id, 'CANCELED');
    return { status: 'CANCELED' };
  }

  /* ---------------- PayPal ---------------- */

  async handlePaypalWebhook(input: { headers: Record<string, string>; rawBody: string }) {
    // Mock verification: real mode calls PayPal verify-webhook-signature (packages/paypal).
    const verified = Boolean(input.headers['paypal-transmission-sig'] && input.headers['paypal-transmission-id']);
    let body: { event_type?: string; id?: string; resource?: { payout_item_id?: string; transaction_status?: PayoutItemStatus; transaction_id?: string } };
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      throw new HttpError(400, 'Body is not JSON');
    }
    const eventType = body.event_type ?? 'UNKNOWN';
    if (!verified) return { verified, eventType };
    this.emit({ type: 'webhook.verified', at: now(), eventType, eventId: body.id ?? `WH-${upper(17)}` }, []);
    const item = [...this.items.values()].find((i) => i.paypalItemId === body.resource?.payout_item_id);
    if (item && body.resource?.transaction_status) this.applyItemStatus(item.id, body.resource.transaction_status, body.resource.transaction_id);
    return { verified, eventType };
  }

  async reconcile(): Promise<ReconcileResult> {
    let matched = 0;
    for (const p of this.history) if (p.status === 'SUCCESS') (this.reconciled.add(p.itemId), matched++);
    for (const i of this.items.values()) if (i.status === 'SUCCESS') (this.reconciled.add(i.id), matched++);
    this.lastReconciledAt = now();
    return { checked: this.history.length + this.items.size, matched, mismatched: 0, at: this.lastReconciledAt, simulated: this.modes.paypalMode !== 'sandbox' };
  }

  async getLedger(): Promise<LedgerView> {
    return buildLedger(this);
  }

  /* ---------------- donors ---------------- */

  async createDonationOrder(input: { amountCents: number; source: DonationSource }): Promise<DonationOrder> {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 100 || input.amountCents > 1_000_000) {
      throw new HttpError(400, 'Amount must be between $1 and $10,000');
    }
    const orderId = `SIM-${upper(16)}`;
    this.orders.set(orderId, { amountCents: input.amountCents, source: input.source, captured: false });
    return { orderId, amountCents: input.amountCents, simulated: true };
  }

  async captureDonationOrder(orderId: string): Promise<DonationCapture> {
    const o = this.orders.get(orderId);
    if (!o) throw new HttpError(404, 'No such order');
    if (!o.captured) {
      o.captured = true;
      this.donations.cents += o.amountCents;
      this.donations.donors += 1;
      this.emit({ type: 'donation.captured', at: now(), amountCents: o.amountCents, source: o.source }, []);
    }
    return { orderId, status: 'COMPLETED', captureId: `CAP-${upper(12)}`, amountCents: o.amountCents, simulated: true };
  }

  async getSubscriptionPlan(input: { amountCents: number }): Promise<SubscriptionPlan> {
    const envKey = `PAYPAL_PLAN_ID_${input.amountCents / 100}`;
    const planId = process.env[envKey] ?? process.env.PAYPAL_PLAN_ID ?? null;
    return { planId, amountCents: input.amountCents, simulated: !planId };
  }

  async recordSubscription(input: { subscriptionId: string; amountCents: number }) {
    this.donations.cents += input.amountCents;
    this.donations.donors += 1;
    this.emit({ type: 'donation.captured', at: now(), amountCents: input.amountCents, source: 'SUBSCRIPTION' }, []);
    return { ok: true, simulated: input.subscriptionId.startsWith('SIM-') };
  }

  /* ---------------- transparency ---------------- */

  async getReport(): Promise<ReportView> {
    return buildReport(this);
  }

  async getTrust(): Promise<TrustView> {
    return buildTrust(this, await this.getGroup());
  }

  /* ---------------- demo stage ---------------- */

  async playScenario(input: { scenario: ScenarioId; mode: PlayMode; speed?: number }): Promise<ScenarioRun> {
    if (++this.runs % 200 === 0) this.prune();
    return runScenario(this, input);
  }

  /** Keep memory bounded on a public demo: drop finished scenario runs older than 30 minutes. */
  private prune() {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, rec] of this.recs) {
      if (rec.scenario && Date.parse(rec.request.createdAt) < cutoff) this.recs.delete(id);
    }
  }

  async resetDemo() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.recs.clear();
    this.batches.clear();
    this.items.clear();
    this.orders.clear();
    this.log = [];
    this.reconciled.clear();
    this.donations = { cents: HISTORY_DONATIONS.cents, donors: HISTORY_DONATIONS.donors };
    this.seed();
  }
}

function hash(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex');
}
