/**
 * Neighbor intake: voice/text → agents.intake (schema-validated extraction + read-back) → stored
 * request → confirm → code computes the amount (core.computeAmount) and checks the rail
 * (core.checkRail) → awaiting_approval. The intake agent has no tools: nothing here can pay.
 */
import { splitUntranslated } from '../../untranslated';
import {
  redactPII,
  checkRail,
  computeAmount,
  hasBlockingFlag,
  householdWindow,
  render,
  type Channel,
  type HelpRequest,
  type IntakeExtraction,
  type Lang,
  type PayoutDestination,
  type Policy,
  type RailFlag,
} from '@neighborline/core';
import { composeReadBack, fixtureAudioBytes, getScenario, questionText, translateWithCheck, type IntakeResult as AgentIntake } from '@neighborline/agents';
import {
  appendAudit,
  createRequest,
  getGroupBySlug,
  getHistoryForDestination,
  getRailHandles,
  getRequest,
  getTodaySpentCents,
  recordNotification,
  updateRequest,
} from '@neighborline/db';
import type { AmountBreakdown, IntakeResult, ThreadMessage, ThreadView } from '../../types';
import type { AudioInput } from '../services';
import { disposeAudio, type AudioOutcome } from '../audio-retention';
import { HttpError } from '../errors';
import * as tpl from '../fixtures/templates';
import { activePolicy, asLang, categoriesFor, fixtureForLang, isDemoId, FIXTURE_FOR, type BaseCtx as Ctx } from './context';
import { nowIso } from './events';
import { demoSpentTodayCents } from './queries';
import { appealAck, categoryLabelIn, householdAnswer, questionFor } from './conversation';
import { getThread } from './views';
import { ui } from '../../i18n';

export async function startIntake(
  ctx: Ctx,
  input: { groupSlug: string; channel: Channel; lang?: Lang; contact?: HelpRequest['contact'] },
  opts: { id?: string } = {},
): Promise<{ requestId: string }> {
  const group = await getGroupBySlug(ctx.db, input.groupSlug);
  if (!group) throw new HttpError(404, `No group "${input.groupSlug}"`);
  // `contact` is set by the phone line only (the caller's number, for call-backs and household caps).
  const req = await createRequest(ctx.db, { ...(opts.id ? { id: opts.id } : {}), groupId: group.id, channel: input.channel, lang: input.lang ?? 'en', ...(input.contact ? { contact: input.contact } : {}) });
  ctx.meta.ensure(req.id, { displayName: 'Neighbor', area: input.channel === 'phone' ? 'by phone' : 'via web' });
  ctx.bus.emit({ type: 'request.created', at: req.createdAt, requestId: req.id, lang: req.lang, channel: req.channel }, [req.id]);
  return { requestId: req.id };
}

async function loadReq(ctx: Ctx, id: string, opts: { open?: boolean } = {}): Promise<HelpRequest> {
  const r = await getRequest(ctx.db, id);
  if (!r || r.groupId !== ctx.gen.group.id) throw new HttpError(404, `No request ${id}`);
  if (opts.open) assertOpen(r);
  return r;
}

function assertOpen(r: HelpRequest): void {
  if (r.status !== 'intake' && r.status !== 'needs_clarification') {
    throw new HttpError(409, r.status === 'declined' ? 'This request was already looked at again; that decision is final.' : 'This request was already sent to the organizers.');
  }
}

const live = (ctx: Ctx) => ctx.agents.providers.mode === 'live';

export async function submitAudio(ctx: Ctx, requestId: string, input: AudioInput, opts: { voiceMessageId?: string } = {}): Promise<IntakeResult> {
  const prior = await loadReq(ctx, requestId);
  // A voice reply to a question (or to a decline): transcribe it, then treat it like typed text.
  if (prior.originalText.trim() || prior.status === 'declined') return voiceReply(ctx, prior, input);
  assertOpen(prior);
  const req = prior;
  const policy = await activePolicy(ctx);
  const categories = categoriesFor(policy);
  let result: AgentIntake;
  let simulated = !live(ctx);
  if (input.sampleId) {
    const fixtureId = FIXTURE_FOR[input.sampleId];
    if (live(ctx)) {
      // Live AI but a bundled sample: the bytes are a fixture marker, not speech — run the real LLM on its transcript.
      result = await ctx.agents.intake.fromText({ text: getScenario(fixtureId).transcript, categories, speakReadBack: true });
      simulated = true;
    } else {
      result = await ctx.agents.intake.fromAudio({ audio: fixtureAudioBytes(fixtureId), mimeType: 'audio/webm', categories, speakReadBack: true, fixtureHint: { fixtureId } });
    }
  } else if (input.audio) {
    const audio = new Uint8Array(await input.audio.arrayBuffer());
    const name = (input.audio as Blob & { name?: string }).name;
    const mimeType = input.audio.type || 'audio/webm';
    let kept: AudioOutcome;
    try {
      result = await ctx.agents.intake.fromAudio({
        audio,
        mimeType,
        categories,
        ...(input.lang ? { langHint: input.lang } : {}),
        speakReadBack: true,
        fixtureHint: live(ctx) ? { ...(name ? { filename: name } : {}) } : { fixtureId: fixtureForLang(input.lang) },
      });
    } finally {
      // Only the transcript is kept: AUDIO_RETENTION=none (default) wipes the recording now.
      kept = disposeAudio(ctx.cfg.audio, { requestId, audio, mimeType });
    }
    await appendAudit(ctx.db, {
      actor: 'intake',
      action: kept.retention === 'none' ? 'audio.deleted' : 'audio.retained',
      entityType: 'request',
      entityId: requestId,
      data: { bytes: kept.bytes, retention: kept.retention, ...(kept.expiresAt ? { deleteAfter: kept.expiresAt } : {}) },
    });
    if (kept.ref) await updateRequest(ctx.db, requestId, { audioRef: kept.ref }, { actor: 'intake' });
  } else {
    throw new HttpError(400, 'Send a recording or pick a sample voice note.');
  }
  const lang = asLang(result.lang, req.lang);
  const seconds = result.transcript.durationSec ? Math.round(result.transcript.durationSec) : undefined;
  const meta = ctx.meta.ensure(requestId);
  if (seconds) meta.audioSeconds = seconds;
  const neighbor = { kind: 'voice' as const, lang, text: result.originalText, textEn: result.englishText || undefined, meta: seconds ? { audioSeconds: seconds } : undefined };
  const existing = opts.voiceMessageId ? meta.thread.find((m) => m.id === opts.voiceMessageId) : undefined;
  if (existing) Object.assign(existing, neighbor);
  else ctx.meta.message(requestId, { from: 'neighbor', ...neighbor });
  if (input.photo) ctx.meta.message(requestId, { from: 'neighbor', kind: 'photo', lang, text: 'Photo' });
  return applyIntake(ctx, req, policy, result, simulated);
}

export async function submitText(
  ctx: Ctx,
  requestId: string,
  input: { text: string; lang?: Lang },
  opts: { recorded?: boolean; simulated?: boolean } = {},
): Promise<IntakeResult> {
  const req = await loadReq(ctx, requestId);
  if (req.status === 'declined') return appeal(ctx, req, input.text.trim(), opts);
  assertOpen(req);
  const policy = await activePolicy(ctx);
  // The agent is stateless: a clarification answer is re-run together with what was said before.
  const prior = req.originalText.trim();
  const text = prior ? `${prior}\n${input.text.trim()}` : input.text.trim();
  const langHint = input.lang ?? (prior ? req.lang : undefined);
  const result = await ctx.agents.intake.fromText({ text, categories: categoriesFor(policy), ...(langHint ? { langHint } : {}), speakReadBack: true });
  const lang = asLang(result.lang, input.lang ?? req.lang);
  if (!opts.recorded) ctx.meta.message(requestId, { from: 'neighbor', kind: 'text', lang, text: input.text.trim(), meta: { channel: req.channel } });
  return applyIntake(ctx, req, policy, result, opts.simulated ?? false);
}

/**
 * Live: speech-to-text on the reply. Offline (AI_MODE=fixture) there is no speech-to-text, so a vetted
 * sample answer to the pending question stands in for the recording — and the thread says so.
 */
async function voiceReply(ctx: Ctx, req: HelpRequest, input: AudioInput): Promise<IntakeResult> {
  const lang = req.lang;
  let text: string;
  let simulated = false;
  let seconds: number | undefined;
  if (live(ctx) && input.audio) {
    const audio = new Uint8Array(await input.audio.arrayBuffer());
    const mimeType = input.audio.type || 'audio/webm';
    try {
      const t = await ctx.agents.providers.stt.transcribe({ audio, mimeType, langHint: lang });
      text = t.text.trim();
      seconds = t.durationSec ? Math.round(t.durationSec) : undefined;
    } finally {
      disposeAudio(ctx.cfg.audio, { requestId: req.id, audio, mimeType });
    }
  } else {
    const policy = await activePolicy(ctx);
    text = sampleAnswer(req, policy);
    simulated = true;
  }
  if (!text) throw new HttpError(400, 'We couldn’t hear anything in that recording.');
  ctx.meta.message(req.id, { from: 'neighbor', kind: 'voice', lang, text, meta: { audioSeconds: seconds ?? Math.max(2, Math.round(text.length / 12)) } });
  return submitText(ctx, req.id, { text, lang }, { recorded: true, simulated });
}

function sampleAnswer(req: HelpRequest, policy: Policy): string {
  const q = questionFor(req, policy, undefined, { blocked: hasBlockingFlag(req.railFlags) });
  const lang = req.lang;
  switch (q?.key) {
    case 'ask_payout':
      // Unique per request, so rehearsals never trip the per-destination velocity cap.
      return `Venmo @neighbor-${req.id.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase()}`;
    case 'ask_category':
      return categoryLabelIn(policy, 'groceries', lang);
    case 'ask_household':
      return householdAnswer(3, lang);
    case 'appeal':
      return q.answers[0]?.send ?? 'REVIEW';
    default:
      return getScenario(fixtureForLang(lang)).transcript;
  }
}

/**
 * The neighbor answered a decline ("REVIEW", or anything they want to add): the request goes back to the
 * queue with the first decision attached, for a different organizer. One appeal per request.
 */
async function appeal(ctx: Ctx, req: HelpRequest, text: string, opts: { recorded?: boolean; simulated?: boolean }): Promise<IntakeResult> {
  const meta = ctx.meta.ensure(req.id);
  if (meta.appeal) throw new HttpError(409, 'This request was already looked at again; that decision is final.');
  if (!req.payoutDestination || !req.extracted) throw new HttpError(409, 'This request can’t be reopened.');
  const lang = req.lang;
  if (!opts.recorded) ctx.meta.message(req.id, { from: 'neighbor', kind: 'text', lang, text, meta: { channel: req.channel } });
  let textEn: string | undefined;
  if (lang !== 'en' && live(ctx)) {
    const t = await translateWithCheck(ctx.agents.providers.llm, { text, targetLang: 'en', facts: [] }).catch(() => null);
    if (t?.translated) textEn = t.text;
  }
  const policy = await activePolicy(ctx);
  const rail = await railFor(ctx, req, policy, req.payoutDestination);
  const updated = await updateRequest(
    ctx.db,
    req.id,
    { status: 'awaiting_approval', computed: rail.computed, railFlags: rail.flags, policyVersionId: policy.id },
    { actor: 'requester' },
  );
  const firstDecline = meta.decline ?? { organizerId: 'unknown', reasonCode: 'other' as const, at: nowIso() };
  meta.appeal = { at: nowIso(), text, ...(textEn ? { textEn } : {}), firstDecline };
  meta.breakdown = rail.breakdown;
  delete meta.decline;
  await appendAudit(ctx.db, { actor: 'requester', action: 'request.appealed', entityType: 'request', entityId: req.id, data: { firstDeclineBy: firstDecline.organizerId, reasonCode: firstDecline.reasonCode } });
  const ack = appealAck(lang);
  ctx.meta.message(req.id, { from: 'line', kind: 'ack', lang, text: ack.text, textEn: ack.textEn });
  const channel = req.channel === 'sms' ? 'sms' : 'whatsapp';
  await recordNotification(ctx.db, { requestId: req.id, channel, lang, messageKey: 'confirmed_waiting', text: ack.text, status: 'sent' });
  ctx.bus.emit({ type: 'request.confirmed', at: nowIso(), requestId: req.id }, [req.id]);
  ctx.bus.emit({ type: 'notify.sent', at: nowIso(), requestId: req.id, lang, text: ack.text, channel }, [req.id]);
  if (rail.flags.length) ctx.bus.emit({ type: 'request.flagged', at: nowIso(), requestId: req.id, flags: rail.flags }, [req.id]);
  return {
    requestId: req.id,
    status: updated.status,
    transcript: { text, lang, textEn: textEn ?? text },
    readBack: { text: ack.text, lang, textEn: ack.textEn },
    extraction: req.extracted,
    missing: req.extracted.missing,
    simulatedTranscript: opts.simulated ?? false,
  };
}

function destinationFrom(x: IntakeExtraction | null, nameOnFile: string | undefined): PayoutDestination | null {
  if (!x?.payout) return null;
  return { ...x.payout, ...(nameOnFile ? { nameOnFile } : {}) };
}

/** The read-back in English for organizers and judges; the neighbor's own read-back when no translation exists (offline mode). */
function englishReadBack(x: IntakeExtraction | null, fallback: string): string {
  if (!x || splitUntranslated(x.summaryEn).untranslated) return fallback;
  return composeReadBack({ summaryNative: x.summaryEn, ...(x.payout ? { payout: x.payout } : {}) }, 'en');
}

async function applyIntake(ctx: Ctx, req: HelpRequest, policy: Policy, result: AgentIntake, simulated: boolean): Promise<IntakeResult> {
  const lang = asLang(result.lang, req.lang);
  const meta = ctx.meta.ensure(req.id);
  // Traces are diagnostics: they never need a handle, email or phone number (shown on organizer cards and /demo).
  meta.aiTrace = { status: result.trace.status, summary: redactPII(result.trace.summary) };
  const x = result.extraction;
  const dest = destinationFrom(x, meta.nameOnFile);
  const status = result.status === 'needs_clarification' ? 'needs_clarification' : 'intake';
  const updated = await updateRequest(
    ctx.db,
    req.id,
    { lang, originalText: result.originalText, englishText: result.englishText, extracted: x, payoutDestination: dest, status, railFlags: [], computed: null },
    { actor: 'intake-agent' },
  );
  ctx.bus.emit({ type: 'request.transcribed', at: nowIso(), requestId: req.id, text: result.originalText, lang }, [req.id]);

  // Rail check right away: a lookalike/impersonation destination is never read back as "where your money goes".
  if (x && dest) {
    const rail = await railFor(ctx, updated, policy, dest);
    if (hasBlockingFlag(rail.flags)) return blockAtIntake(ctx, updated, policy, rail, simulated);
  }

  const readBackEn = englishReadBack(x, result.readBack.text);
  ctx.meta.message(req.id, { from: 'line', kind: 'readback', lang, text: result.readBack.text, textEn: readBackEn });
  const q = result.clarifyingQuestion;
  // When the extraction failed outright, the read-back already IS "tell me again": don't say it twice.
  if (q && q.text !== result.readBack.text) {
    meta.question = { key: q.key, text: q.text, lang };
    ctx.meta.message(req.id, { from: 'line', kind: 'question', lang, text: q.text, textEn: questionText(q.key, 'en') });
  } else if (q) meta.question = { key: q.key, text: q.text, lang };
  else delete meta.question;
  ctx.bus.emit({ type: 'request.readback', at: nowIso(), requestId: req.id, text: result.readBack.text, lang }, [req.id]);
  const audio = result.readBack.audio;
  return {
    requestId: req.id,
    status: updated.status,
    transcript: { text: result.originalText, lang, textEn: result.englishText },
    readBack: { text: result.readBack.text, lang, textEn: readBackEn, ...(audio && !audio.useBrowserSpeech ? { audioUrl: `data:${audio.mimeType};base64,${audio.base64}` } : {}) },
    extraction: x ?? placeholderExtraction(lang, result.englishText || result.originalText),
    missing: x?.missing ?? ['payout', 'category'],
    simulatedTranscript: simulated,
  };
}

function placeholderExtraction(lang: Lang, text: string): IntakeExtraction {
  const s = (text || '…').slice(0, 600);
  return { lang, summaryEn: s, summaryNative: s, category: 'other', urgency: 'today', requestedItems: [], missing: ['payout', 'category'], confidence: 0 };
}

export interface Rail {
  flags: RailFlag[];
  computed: Extract<ReturnType<typeof computeAmount>, { ok: true }>['computed'] | null;
  breakdown: AmountBreakdown | null;
}

/** core.computeAmount + core.checkRail with db history (demo rehearsals excluded) and the group's handles. */
export async function railFor(ctx: Ctx, req: HelpRequest, policy: Policy, dest: PayoutDestination): Promise<Rail> {
  const now = new Date();
  const phone = req.contact?.phone ?? req.contact?.whatsapp;
  const history = (await getHistoryForDestination(ctx.db, dest, 30, { groupId: req.groupId, ...(phone ? { phone } : {}) })).filter((h) => !isDemoId(h.requestId));
  const today = Math.max(0, (await getTodaySpentCents(ctx.db, req.groupId)) - (await demoSpentTodayCents(ctx.db, req.groupId)));
  const extraction = req.extracted ?? { category: 'other' };
  const amount = computeAmount({ policy, extraction, history, todaySpentCents: today, destination: dest, ...(phone ? { phone } : {}), now, requestId: req.id });
  const handles = await getRailHandles(ctx.db, req.groupId);
  // Compare like with like first (a Venmo handle against the group's Venmo handle), so the flag names the handle it imitates.
  const sameKind = (h: string) => (dest.type === 'USER_HANDLE') === h.trim().startsWith('@');
  const groupHandles = [...handles.groupHandles].sort((a, b) => Number(sameKind(b)) - Number(sameKind(a)));
  const flags = checkRail({ destination: dest, groupHandles, organizerHandles: handles.organizerHandles, history, policy, text: [req.originalText, req.englishText], now, requestId: req.id });
  if (!amount.ok) flags.unshift(...amount.flags.filter((f) => !flags.some((g) => g.code === f.code)));
  flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1));
  let breakdown: AmountBreakdown | null = null;
  if (amount.ok) {
    const cat = policy.categories.find((c) => c.key === amount.computed.ruleKey);
    const window = householdWindow(history, { destination: dest, phone }, now, { excludeRequestId: req.id });
    const used = window.reduce((s, h) => s + h.amountCents, 0);
    const catUsed = window.filter((h) => h.ruleKey === amount.computed.ruleKey).reduce((s, h) => s + h.amountCents, 0);
    const lb = amount.computed.limitedBy;
    breakdown = {
      requestedCents: req.extracted?.requestedAmountCents ?? null,
      categoryMaxCents: cat?.maxCents ?? amount.computed.amountCents,
      householdRemainingCents: Math.max(0, Math.min(policy.householdCapPer30dCents - used, (cat?.perHouseholdPer30dCents ?? Infinity) - catUsed)),
      dailyRemainingCents: Math.max(0, policy.dailyBudgetCents - today),
      resultCents: amount.computed.amountCents,
      limitedBy: lb === 'requested' ? 'requested' : lb === 'daily_budget' ? 'daily' : lb === 'household_cap' || lb === 'category_household_cap' ? 'household' : 'category',
    };
  }
  return { flags, computed: amount.ok ? amount.computed : null, breakdown };
}

async function blockAtIntake(ctx: Ctx, req: HelpRequest, policy: Policy, rail: Rail, simulated: boolean): Promise<IntakeResult> {
  const updated = await updateRequest(
    ctx.db,
    req.id,
    { status: 'awaiting_approval', computed: rail.computed, railFlags: rail.flags, policyVersionId: policy.id },
    { actor: 'rail-protection' },
  );
  const meta = ctx.meta.ensure(req.id);
  meta.breakdown = rail.breakdown;
  ctx.bus.emit({ type: 'request.flagged', at: nowIso(), requestId: req.id, flags: rail.flags }, [req.id]);
  const reply = tpl.blockedReply(updated.lang);
  ctx.meta.message(req.id, { from: 'line', kind: 'blocked', lang: updated.lang, text: reply.text, textEn: reply.textEn, meta: { channel: updated.channel } });
  await recordNotification(ctx.db, { requestId: req.id, channel: updated.channel, lang: updated.lang, messageKey: 'needs_info', text: reply.text, status: 'sent' });
  ctx.bus.emit({ type: 'notify.sent', at: nowIso(), requestId: req.id, lang: updated.lang, text: reply.text, channel: updated.channel }, [req.id]);
  const x = updated.extracted!;
  return {
    requestId: req.id,
    status: updated.status,
    transcript: { text: updated.originalText, lang: updated.lang, textEn: updated.englishText },
    readBack: { text: reply.text, lang: updated.lang, textEn: reply.textEn },
    extraction: x,
    missing: x.missing,
    simulatedTranscript: simulated,
  };
}

export async function confirmIntake(
  ctx: Ctx,
  requestId: string,
  input: { confirmed: boolean; corrections?: string },
): Promise<{ status: HelpRequest['status']; thread: ThreadView }> {
  let req = await loadReq(ctx, requestId);
  const done = async () => ({ status: (await loadReq(ctx, requestId)).status, thread: (await getThread(ctx, requestId))! });
  if (req.status !== 'intake' && req.status !== 'needs_clarification') return done(); // double tap / already filed
  if (!input.confirmed) {
    if (input.corrections) await submitText(ctx, requestId, { text: input.corrections });
    else await updateRequest(ctx.db, requestId, { status: 'needs_clarification' }, { actor: 'requester' });
    return done();
  }
  const lang = req.lang;
  ctx.meta.message(requestId, { from: 'neighbor', kind: 'text', lang, text: ui(lang).yes, textEn: 'Yes, that’s right' });
  if (!req.payoutDestination || !req.extracted) {
    await updateRequest(ctx.db, requestId, { status: 'needs_clarification', confirmedByRequester: true }, { actor: 'requester' });
    const ask = ctx.meta.ensure(requestId).question?.key === 'ask_payout' ? ctx.meta.ensure(requestId).question!.text : render('ask_payout', lang);
    ctx.meta.message(requestId, { from: 'line', kind: 'question', lang, text: ask, textEn: render('ask_payout', 'en') });
    ctx.bus.emit({ type: 'request.confirmed', at: nowIso(), requestId }, [requestId]);
    return done();
  }
  const policy = await activePolicy(ctx);
  const rail = await railFor(ctx, req, policy, req.payoutDestination);
  req = await updateRequest(
    ctx.db,
    requestId,
    { status: 'awaiting_approval', confirmedByRequester: true, computed: rail.computed, railFlags: rail.flags, policyVersionId: policy.id },
    { actor: 'requester' },
  );
  ctx.meta.ensure(requestId).breakdown = rail.breakdown;
  const blocked = hasBlockingFlag(rail.flags);
  const note = await ctx.agents.notify.render({ key: blocked ? 'needs_info' : 'confirmed_waiting', lang });
  const kind: ThreadMessage['kind'] = blocked ? 'status' : 'ack';
  ctx.meta.message(requestId, { from: 'line', kind, lang, text: note.text, textEn: note.textEn });
  await recordNotification(ctx.db, { requestId, channel: req.channel, lang, messageKey: note.key, text: note.text, status: 'sent' });
  ctx.bus.emit({ type: 'request.confirmed', at: nowIso(), requestId }, [requestId]);
  if (rail.flags.length) ctx.bus.emit({ type: 'request.flagged', at: nowIso(), requestId, flags: rail.flags }, [requestId]);
  return done();
}
