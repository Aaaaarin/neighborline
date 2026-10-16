/**
 * The phone line's entry point into the engine (channel 'phone'). Built on the narrowed intake context
 * (BaseCtx: no approval service), so nothing reachable from a phone call can move money: a call can
 * create a request, transcribe and re-run intake, and confirm it into the organizers' queue. That's all.
 *
 * Recordings: the first one is the request (agents STT + extraction, exactly the web voice path). Later
 * ones are answers (payout handle, a clarifying question, "try again"): transcribed, then intake re-runs
 * on the combined text, like a typed correction on /call. The raw audio is wiped after transcription
 * (AUDIO_RETENTION) and the Twilio copy is deleted by the call flow; both are audit-logged.
 */
import { hasBlockingFlag, type Lang } from '@neighborline/core';
import type { TTS } from '@neighborline/agents';
import { appendAudit, getRequest } from '@neighborline/db';
import type { ThreadQuestion } from '../../types';
import { disposeAudio } from '../audio-retention';
import { HttpError } from '../errors';
import type { BaseCtx } from '../engine/context';
import * as intake from '../engine/intake';
import { getThread } from '../engine/views';

export type AnswerKind = 'venmo' | 'paypal' | 'question' | 'retry';

export interface PhoneTurn {
  requestId: string;
  status: string;
  lang: Lang;
  readBack: { text: string; textEn: string; audioDataUrl?: string };
  /** A question the caller must answer before the request can be filed (never the optional household one). */
  question: ThreadQuestion | null;
  awaitingConfirmation: boolean;
  /** Rail protection stopped it at intake (lookalike handle, …): organizers review, nothing to confirm. */
  blocked: boolean;
  simulated: boolean;
}

export interface PhoneIntake {
  readonly aiLive: boolean;
  readonly tts: TTS;
  readonly timezone: string | null;
  start(input: { callerPhone: string | null }): Promise<{ requestId: string }>;
  /** The request exists, came in by phone, and belongs to this caller's number. */
  owns(requestId: string, callerPhone: string | null): Promise<boolean>;
  lang(requestId: string): Promise<Lang>;
  submitRecording(requestId: string, input: { audio: Uint8Array; mimeType: string; answer?: AnswerKind }): Promise<PhoneTurn>;
  /** A keypad answer to a question with fixed answers (category): `send` from ThreadQuestion.answers. */
  answer(requestId: string, text: string): Promise<PhoneTurn>;
  /** The state after the last turn (re-reading a prompt after no key was pressed). */
  current(requestId: string): Promise<PhoneTurn>;
  confirm(requestId: string): Promise<{ status: string; lang: Lang }>;
  /** "Press 2 to try again". */
  reject(requestId: string): Promise<void>;
  audit(requestId: string, action: string, data: Record<string, unknown>): Promise<void>;
}

const PREFIX: Record<'venmo' | 'paypal', string> = { venmo: 'Venmo', paypal: 'PayPal email' };

export function phoneBridge(ctx: BaseCtx): PhoneIntake {
  const live = ctx.agents.providers.mode === 'live';

  async function turn(requestId: string, simulated: boolean, readBackOverride?: { text: string; textEn: string; audioUrl?: string }): Promise<PhoneTurn> {
    const t = await getThread(ctx, requestId);
    const r = await getRequest(ctx.db, requestId);
    if (!t || !r) throw new HttpError(404, 'No such request');
    const last = [...t.messages].reverse().find((m) => m.from === 'line' && (m.kind === 'readback' || m.kind === 'blocked'));
    const rb = readBackOverride ?? (last ? { text: last.text, textEn: last.textEn ?? last.text } : { text: '', textEn: '' });
    const q = t.question && !t.question.optional && t.question.key !== 'appeal' ? t.question : null;
    return {
      requestId,
      status: r.status,
      lang: r.lang,
      readBack: { text: rb.text, textEn: rb.textEn, ...(rb.audioUrl?.startsWith('data:') ? { audioDataUrl: rb.audioUrl } : {}) },
      question: q,
      awaitingConfirmation: t.awaitingConfirmation,
      blocked: r.status === 'awaiting_approval' && hasBlockingFlag(r.railFlags),
      simulated,
    };
  }

  async function load(requestId: string) {
    const r = await getRequest(ctx.db, requestId);
    if (!r || r.groupId !== ctx.gen.group.id || r.channel !== 'phone') throw new HttpError(404, 'No such request');
    return r;
  }

  /** Answers: transcribe (live) or a labelled sample answer (fixture), then re-run intake on the combined text. */
  async function answerRecording(requestId: string, input: { audio: Uint8Array; mimeType: string; answer: AnswerKind }): Promise<PhoneTurn> {
    const r = await load(requestId);
    const lang = r.lang;
    let text: string;
    let seconds: number | undefined;
    const wallet = input.answer === 'venmo' || input.answer === 'paypal' ? input.answer : null;
    try {
      if (live) {
        const t = await ctx.agents.providers.stt.transcribe({ audio: input.audio, mimeType: input.mimeType, langHint: lang });
        text = t.text.trim();
        seconds = t.durationSec ? Math.round(t.durationSec) : undefined;
      } else if (wallet) {
        // AI_MODE=fixture has no speech-to-text: a sample answer, unique per request (never trips velocity caps).
        const tag = requestId.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase();
        text = wallet === 'venmo' ? `@caller-${tag}` : `caller.${tag}@example.com`;
      } else {
        text = '';
      }
    } finally {
      const kept = disposeAudio(ctx.cfg.audio, { requestId, audio: input.audio, mimeType: input.mimeType });
      await appendAudit(ctx.db, { actor: 'intake', action: kept.retention === 'none' ? 'audio.deleted' : 'audio.retained', entityType: 'request', entityId: requestId, data: { bytes: kept.bytes, retention: kept.retention, channel: 'phone' } });
    }
    if (!live && !wallet) {
      // Fixture mode, open answer: the engine's own labelled sample answer for the pending question.
      const res = await intake.submitAudio(ctx, requestId, { audio: new Blob([new Uint8Array(16)], { type: input.mimeType }) });
      return turn(requestId, true, res.readBack);
    }
    if (!text) throw new HttpError(400, 'We couldn’t hear anything in that recording.');
    ctx.meta.message(requestId, { from: 'neighbor', kind: 'voice', lang, text, meta: { audioSeconds: seconds ?? Math.max(2, Math.round(text.length / 12)), channel: 'phone' } });
    const res = await intake.submitText(ctx, requestId, { text: wallet ? `${PREFIX[wallet]} ${text}` : text, lang }, { recorded: true, simulated: !live });
    return turn(requestId, !live, res.readBack);
  }

  return {
    aiLive: live,
    tts: ctx.agents.providers.tts,
    timezone: (ctx.gen.group as { timezone?: string }).timezone ?? null,
    async start({ callerPhone }) {
      return intake.startIntake(ctx, { groupSlug: ctx.gen.group.slug, channel: 'phone', ...(callerPhone ? { contact: { phone: callerPhone } } : {}) });
    },
    async owns(requestId, callerPhone) {
      const r = await getRequest(ctx.db, requestId);
      if (!r || r.groupId !== ctx.gen.group.id || r.channel !== 'phone') return false;
      return (r.contact?.phone ?? null) === (callerPhone ?? null);
    },
    async lang(requestId) {
      return (await load(requestId)).lang;
    },
    async submitRecording(requestId, input) {
      const r = await load(requestId);
      if (input.answer || r.originalText.trim()) return answerRecording(requestId, { ...input, answer: input.answer ?? 'retry' });
      const res = await intake.submitAudio(ctx, requestId, { audio: new Blob([new Uint8Array(input.audio)], { type: input.mimeType }) });
      input.audio.fill(0);
      return turn(requestId, res.simulatedTranscript, res.readBack);
    },
    async answer(requestId, text) {
      await load(requestId);
      const res = await intake.submitText(ctx, requestId, { text });
      return turn(requestId, false, res.readBack);
    },
    async current(requestId) {
      await load(requestId);
      return turn(requestId, false);
    },
    async confirm(requestId) {
      await load(requestId);
      const out = await intake.confirmIntake(ctx, requestId, { confirmed: true });
      return { status: out.status, lang: out.thread.lang };
    },
    async reject(requestId) {
      await load(requestId);
      await intake.confirmIntake(ctx, requestId, { confirmed: false });
    },
    async audit(requestId, action, data) {
      await appendAudit(ctx.db, { actor: 'phone-line', action, entityType: 'request', entityId: requestId, data });
    },
  };
}
