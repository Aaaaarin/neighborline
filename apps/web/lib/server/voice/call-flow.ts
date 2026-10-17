/**
 * The inbound call, as a state machine over Twilio webhooks (docs/PHONE.md has the diagram):
 *
 *   incoming ── greet ─ <Record> ──▶ recorded ── "one moment" ──▶ wait ⟲ (poll the job)
 *                                   recording-status ─▶ job: download (auth) → engine intake (STT +
 *                                                       extraction) → DELETE the Twilio recording
 *   wait (job done) ─▶ blocked?   say the rail-protection reply, goodbye
 *                   ─▶ payout?    read back, "press 1 Venmo, 2 PayPal" ─▶ payout ─ <Record> ─▶ …
 *                   ─▶ question?  keypad menu (fixed answers) ─▶ menu, or <Record> the answer ─▶ …
 *                   ─▶ else       read back, "press 1 if right, 2 to try again" ─▶ confirm
 *   confirm 1 ─▶ engine confirm (code computes the amount, rail checks) ─▶ "two neighbors will look at it"
 *   confirm 2 ─▶ "tell us again" ─ <Record> ─▶ …
 *
 * Every webhook must carry a valid X-Twilio-Signature for our auth token and our AccountSid (403
 * otherwise). State that matters lives in the signed action URLs (request id, attempt counters) and in
 * the database; each step re-checks that the request belongs to the calling number.
 */
import type { Lang } from '@neighborline/core';
import type { Env } from '../engine/env';
import { HttpError, isHttpError } from '../errors';
import { errorText, log } from '../log';
import { LIMITS, type BucketSpec, type TokenLimiter } from '../security/rate-limit';
import { readCapped } from '../security/guard';
import type { AnswerKind, PhoneIntake, PhoneTurn } from './bridge';
import type { CallClock, JobStore } from './calls';
import type { ClipStore } from './clips';
import type { PhoneConfig } from './config';
import { phrase, type PhraseKey } from './phrases';
import { candidateUrls, param, parseForm, validateSignature, type TwilioParams } from './signature';
import { createSpeaker, type Speaker } from './speech';
import { recordingSidFrom, type TwilioApi } from './twilio-api';
import { gatherDigits, hangup, pause, record, redirect, response, say, twimlResponse, type TwimlNode } from './twiml';

export interface VoiceDeps {
  cfg: PhoneConfig;
  env: Env;
  phone: () => Promise<PhoneIntake>;
  api: TwilioApi;
  clips: ClipStore;
  jobs: JobStore;
  calls: CallClock;
  /** The process-wide limiter (shared Postgres buckets when the engine has a shared database). */
  limiter: TokenLimiter;
}

export const VOICE_STEPS = ['incoming', 'recorded', 'recording-status', 'wait', 'confirm', 'payout', 'menu'] as const;
export type VoiceStep = (typeof VOICE_STEPS)[number];

/** Per calling number: 4 calls at once, then one more every 15 minutes. All callers together: 60, +1 per 10 s. */
export const CALLER_LIMIT: BucketSpec = { capacity: 4, refillSeconds: 900 };
export const LINE_LIMIT: BucketSpec = { capacity: 60, refillSeconds: 10 };
/** Polls of ~2 s while a recording is transcribed before we give up (~50 s). */
export const MAX_WAIT_POLLS = 25;
/** Times a keypad prompt is repeated when nothing (or a wrong key) is pressed. */
const MAX_REPEATS = 2;

/**
 * Twilio's `From` for a withheld caller ID: the carrier's word turned into digits
 * (support.twilio.com/hc/en-us/articles/223179988): RESTRICTED 7378742833, BLOCKED 2562533, UNKNOWN 8656696,
 * ANONYMOUS 266696687, UNAVAILABLE 86282452253, EMPTY / no caller ID 464.
 */
const WITHHELD_DIGITS = new Set(['7378742833', '17378742833', '2562533', '8656696', '266696687', '86282452253', '464']);
const WITHHELD_WORDS = new Set(['anonymous', 'restricted', 'unknown', 'blocked', 'unavailable', 'private', '']);

/** The caller's E.164 number, or null when it is withheld or not a phone number (SIP, client:…). */
export function callerNumber(from: string): string | null {
  const f = from.trim();
  if (WITHHELD_WORDS.has(f.toLowerCase())) return null;
  if (WITHHELD_DIGITS.has(f.replace(/\D/g, ''))) return null;
  return /^\+[1-9]\d{7,14}$/.test(f) ? f : null;
}

const RID = /^req_[A-Za-z0-9_]{3,80}$/;
const RS = /^RE[0-9a-fA-F]{32}$/;
const KINDS = ['request', 'venmo', 'paypal', 'question', 'retry'] as const;
type RecordKind = (typeof KINDS)[number];

const int = (v: string | null, dflt = 0): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : dflt;
};

class Call {
  readonly params: TwilioParams;
  readonly q: URLSearchParams;
  readonly speaker: Speaker;
  readonly callSid: string;
  readonly caller: string | null;
  constructor(
    readonly deps: VoiceDeps,
    readonly phone: PhoneIntake,
    params: TwilioParams,
    url: URL,
  ) {
    this.params = params;
    this.q = url.searchParams;
    this.callSid = param(params, 'CallSid');
    this.caller = callerNumber(param(params, 'From'));
    this.speaker = createSpeaker(deps.cfg, { tts: phone.tts, clips: deps.clips, base: '' });
  }

  get rid(): string {
    const rid = this.q.get('rid') ?? '';
    if (!RID.test(rid)) throw new HttpError(400, 'bad request id');
    return rid;
  }

  async p(key: PhraseKey, lang: Lang, vars?: Record<string, string | number>): Promise<TwimlNode> {
    const ph = phrase(key, lang, vars);
    return this.speaker.speak(ph.text, ph.lang, { textEn: phrase(key, 'en', vars).text });
  }

  async end(key: PhraseKey, lang: Lang): Promise<Response> {
    return xml(await this.p(key, lang), await this.p('goodbye', lang), hangup());
  }

  /** <Record> for `kind`, unless this call already used its recordings. */
  async recordNext(rid: string, kind: RecordKind, n: number, lang: Lang, ...before: TwimlNode[]): Promise<Response> {
    if (!this.deps.calls.takeRecording(this.callSid, this.deps.cfg.maxRecordingsPerCall)) return this.end('gaveUp', lang);
    const qs = `rid=${rid}&kind=${kind}&n=${n}`;
    return xml(...before, record({ action: `/api/voice/recorded?${qs}`, recordingStatusCallback: `/api/voice/recording-status?${qs}`, maxLength: this.deps.cfg.maxRecordSeconds }));
  }
}

const xml = (...nodes: TwimlNode[]): Response => twimlResponse(response(...nodes));

/** Entry point for every POST /api/voice/<step>. */
export async function handleVoice(step: string, req: Request, deps: VoiceDeps): Promise<Response> {
  if (!deps.cfg.enabled) return Response.json({ error: 'The phone line is not configured on this server.' }, { status: 404 });
  if (!(VOICE_STEPS as readonly string[]).includes(step)) return Response.json({ error: 'No such step' }, { status: 404 });
  let params: TwilioParams;
  try {
    params = parseForm(await readCapped(req, 32 * 1024));
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const signature = req.headers.get('x-twilio-signature');
  if (!validateSignature(deps.cfg.authToken, signature, candidateUrls(req, deps.cfg.publicBaseUrl), params) || param(params, 'AccountSid') !== deps.cfg.accountSid) {
    log.warn('voice.signature_rejected', { step, hasSignature: Boolean(signature) });
    return new Response('Invalid Twilio signature', { status: 403 });
  }
  const phone = await deps.phone();
  const call = new Call(deps, phone, params, new URL(req.url));
  try {
    if (step === 'recording-status') return await recordingStatus(call);
    if (step !== 'incoming' && call.callSid && deps.calls.elapsed(call.callSid) > deps.cfg.maxCallSeconds) {
      return await call.end('tooLong', await langOf(call));
    }
    switch (step as VoiceStep) {
      case 'incoming':
        return await incoming(call);
      case 'recorded':
        return await recorded(call);
      case 'wait':
        return await wait(call);
      case 'confirm':
        return await confirm(call);
      case 'payout':
        return await payout(call);
      case 'menu':
        return await menu(call);
      default:
        return Response.json({ error: 'No such step' }, { status: 404 });
    }
  } catch (err) {
    log.error('voice.step_failed', { step, error: errorText(err) });
    const lang = await langOf(call).catch(() => 'en' as Lang);
    return call.end('trouble', lang);
  }
}

async function langOf(call: Call): Promise<Lang> {
  const rid = call.q.get('rid');
  if (!rid || !RID.test(rid)) return 'en';
  return call.phone.lang(rid).catch(() => 'en' as Lang);
}

async function assertOwner(call: Call): Promise<string> {
  const rid = call.rid;
  if (!(await call.phone.owns(rid, call.caller))) throw new HttpError(404, 'request does not belong to this caller');
  return rid;
}

/* ---------------- steps ---------------- */

async function incoming(call: Call): Promise<Response> {
  const { cfg, limiter, env } = call.deps;
  const langs = cfg.greetingLangs;
  if (!call.caller && cfg.blockAnonymous) {
    log.info('voice.anonymous_refused', {});
    const lines = await Promise.all(langs.map((l) => call.p('anonymous', l)));
    return xml(...lines, hangup());
  }
  if ((env.RATE_LIMITS ?? '').toLowerCase() !== 'off') {
    const entries: Array<[string, BucketSpec]> = [
      [`voice:caller:${call.caller ?? 'withheld'}`, CALLER_LIMIT],
      ['voice:line', LINE_LIMIT],
    ];
    if (call.phone.aiLive) entries.push(['ai:global', LIMITS.ai.global]);
    if ((await limiter.takeAll(entries)) > 0) {
      log.info('voice.rate_limited', {});
      const lines = await Promise.all(langs.map((l) => call.p('tooMany', l)));
      return xml(...lines, hangup());
    }
  }
  call.deps.calls.start(call.callSid);
  const { requestId } = await call.phone.start({ callerPhone: call.caller });
  await call.phone.audit(requestId, 'phone.call_started', { callSid: call.callSid, withheld: !call.caller });
  const greeting = await Promise.all(langs.map((l) => call.p('greeting', l)));
  return call.recordNext(requestId, 'request', 1, langs[0] ?? 'en', say('Neighborline.', cfg.voices.en ?? {}), ...greeting);
}

/** Download → engine intake → delete at Twilio, once per recording (action, status callback and poll all call this). */
function ensureJob(call: Call, rid: string, recordingSid: string, kind: RecordKind) {
  const { api, cfg, jobs } = call.deps;
  const url = `${cfg.restBaseUrl}/2010-04-01/Accounts/${cfg.accountSid}/Recordings/${recordingSid}`;
  return jobs.ensure(
    recordingSid,
    async () => {
      let audio: Uint8Array | null = null;
      try {
        const rec = await api.fetchRecording(url);
        audio = rec.audio;
        const answer: AnswerKind | undefined = kind === 'request' ? undefined : kind;
        return await call.phone.submitRecording(rid, { audio, mimeType: rec.mimeType, ...(answer ? { answer } : {}) });
      } finally {
        audio?.fill(0);
        await deleteAtTwilio(call, rid, recordingSid);
      }
    },
    (err) => (isHttpError(err) && err.status === 400 ? 'not_heard' : isHttpError(err) && err.status === 429 ? 'busy' : 'error'),
  );
}

async function deleteAtTwilio(call: Call, rid: string, recordingSid: string): Promise<void> {
  try {
    await call.deps.api.deleteRecording(recordingSid);
    await call.phone.audit(rid, 'phone.recording_deleted', { recordingSid });
  } catch (err) {
    // Not fatal for the caller; the audit row tells an operator to delete it by hand (docs/PHONE.md).
    log.error('voice.recording_delete_failed', { recordingSid, error: errorText(err) });
    await call.phone.audit(rid, 'phone.recording_delete_failed', { recordingSid }).catch(() => {});
  }
}

async function recordingStatus(call: Call): Promise<Response> {
  const rid = await assertOwner(call).catch(() => null);
  const sid = param(call.params, 'RecordingSid');
  const kind = (call.q.get('kind') ?? 'request') as RecordKind;
  if (!rid || !RS.test(sid) || !KINDS.includes(kind)) return new Response(null, { status: 204 });
  const status = param(call.params, 'RecordingStatus');
  const job = call.deps.jobs.get(sid);
  if (status !== 'completed' || job?.state === 'cancelled' || Number(param(call.params, 'RecordingDuration')) < 1) {
    // Failed, absent, empty, or the caller hung up: nothing to transcribe, but never keep the audio.
    if (!job || job.state === 'cancelled') {
      call.deps.jobs.cancel(sid);
      await deleteAtTwilio(call, rid, sid);
    }
    return new Response(null, { status: 204 });
  }
  ensureJob(call, rid, sid, kind);
  return new Response(null, { status: 204 });
}

async function recorded(call: Call): Promise<Response> {
  const rid = await assertOwner(call);
  const kind = call.q.get('kind') as RecordKind;
  if (!KINDS.includes(kind)) throw new HttpError(400, 'bad kind');
  const n = int(call.q.get('n'), 1);
  const lang = kind === 'request' ? (call.deps.cfg.greetingLangs[0] ?? 'en') : await call.phone.lang(rid);
  const sid = recordingSidFrom(call.deps.cfg, param(call.params, 'RecordingUrl'));
  if (!sid) throw new HttpError(400, 'recording url is not ours');
  const duration = Number(param(call.params, 'RecordingDuration'));
  if (param(call.params, 'Digits') === 'hangup') {
    // The caller left. An unconfirmed request is never filed, so don't spend AI on it; the status callback deletes the audio.
    if (!call.deps.jobs.get(sid)) call.deps.jobs.cancel(sid);
    return new Response(null, { status: 204 });
  }
  if (!(duration >= 1)) {
    call.deps.jobs.cancel(sid);
    if (n >= 3) return call.end('gaveUp', lang);
    const again = kind === 'request' ? await call.p('greeting', lang) : await call.p('answerAfterBeep', lang);
    return call.recordNext(rid, kind, n + 1, lang, await call.p('notHeard', lang), again);
  }
  ensureJob(call, rid, sid, kind);
  return xml(await call.p('oneMoment', lang), redirect(`/api/voice/wait?rid=${rid}&rs=${sid}&kind=${kind}&n=${n}&w=0`));
}

async function wait(call: Call): Promise<Response> {
  const rid = await assertOwner(call);
  const rs = call.q.get('rs') ?? '';
  const kind = call.q.get('kind') as RecordKind;
  if (!RS.test(rs) || !KINDS.includes(kind)) throw new HttpError(400, 'bad wait');
  const w = int(call.q.get('w'));
  const n = int(call.q.get('n'), 1);
  // The status callback normally started the job already; a poll starts it if that callback is late.
  const job = call.deps.jobs.get(rs) ?? ensureJob(call, rid, rs, kind);
  const lang = kind === 'request' ? (call.deps.cfg.greetingLangs[0] ?? 'en') : await call.phone.lang(rid);
  if (job.state === 'running') {
    if (w >= MAX_WAIT_POLLS) return call.end('trouble', lang);
    return xml(pause(2), redirect(`/api/voice/wait?rid=${rid}&rs=${rs}&kind=${kind}&n=${n}&w=${w + 1}`));
  }
  if (job.state === 'failed' && job.reason === 'not_heard') {
    if (n >= 3) return call.end('gaveUp', lang);
    return call.recordNext(rid, kind, n + 1, lang, await call.p('notHeard', lang), await call.p(kind === 'request' ? 'greeting' : 'answerAfterBeep', lang));
  }
  if (job.state !== 'done') return call.end('trouble', lang);
  return next(call, job.turn);
}

/** What the caller hears after a turn of intake. */
async function next(call: Call, turn: PhoneTurn, repeat = 0): Promise<Response> {
  const { rid, lang } = { rid: turn.requestId, lang: turn.lang };
  const readBack = () => call.speaker.speak(turn.readBack.text, lang, { textEn: turn.readBack.textEn, ...(turn.readBack.audioDataUrl ? { audioDataUrl: turn.readBack.audioDataUrl } : {}) });
  if (turn.blocked) return xml(await readBack(), await call.p('goodbye', lang), hangup());
  const q = turn.question;
  if (q?.key === 'ask_payout') {
    const prompt = await call.p('payoutChoice', lang);
    const body = repeat ? [prompt] : [await readBack(), prompt];
    return xml(gatherDigits({ action: `/api/voice/payout?rid=${rid}&r=${repeat}` }, ...body), redirect(`/api/voice/payout?rid=${rid}&r=${repeat}&none=1`));
  }
  if (q && q.answers.length > 0 && q.answers.length <= 9) {
    const options = await Promise.all(q.answers.map((a, i) => call.p('pressN', lang, { label: a.label, n: i + 1 })));
    const ask = await call.speaker.speak(q.text, lang);
    return xml(gatherDigits({ action: `/api/voice/menu?rid=${rid}&r=${repeat}` }, ask, ...options), redirect(`/api/voice/menu?rid=${rid}&r=${repeat}&none=1`));
  }
  if (q) return call.recordNext(rid, 'question', 1, lang, await call.speaker.speak(q.text, lang), await call.p('answerAfterBeep', lang));
  if (turn.awaitingConfirmation) {
    return xml(gatherDigits({ action: `/api/voice/confirm?rid=${rid}&r=${repeat}` }, await readBack(), await call.p('confirmPrompt', lang)), redirect(`/api/voice/confirm?rid=${rid}&r=${repeat}&none=1`));
  }
  if (turn.readBack.text) return call.recordNext(rid, 'retry', 1, lang, await readBack(), await call.p('answerAfterBeep', lang));
  return call.recordNext(rid, 'retry', 1, lang, await call.p('tryAgain', lang));
}

/** A keypad step: the pressed digit, or a repeat of the prompt (twice), then goodbye. */
async function keypad(call: Call, onDigit: (rid: string, digit: string, lang: Lang) => Promise<Response | null>): Promise<Response> {
  const rid = await assertOwner(call);
  const lang = await call.phone.lang(rid);
  const digit = call.q.get('none') ? '' : param(call.params, 'Digits');
  const out = digit ? await onDigit(rid, digit, lang) : null;
  if (out) return out;
  const r = int(call.q.get('r')) + 1;
  if (r > MAX_REPEATS) return call.end('gaveUp', lang);
  return next(call, await call.phone.current(rid), r);
}

async function confirm(call: Call): Promise<Response> {
  return keypad(call, async (rid, digit, lang) => {
    if (digit === '1') {
      const out = await call.phone.confirm(rid);
      if (out.status === 'awaiting_approval') {
        await call.phone.audit(rid, 'phone.confirmed', { callSid: call.callSid });
        return xml(await call.p('filed', out.lang), await call.p('goodbye', out.lang), hangup());
      }
      return next(call, await call.phone.current(rid));
    }
    if (digit === '2') {
      await call.phone.reject(rid);
      return call.recordNext(rid, 'retry', 1, lang, await call.p('tryAgain', lang));
    }
    return null;
  });
}

async function payout(call: Call): Promise<Response> {
  return keypad(call, async (rid, digit, lang) => {
    if (digit === '1') return call.recordNext(rid, 'venmo', 1, lang, await call.p('sayVenmo', lang));
    if (digit === '2') return call.recordNext(rid, 'paypal', 1, lang, await call.p('sayPaypal', lang));
    return null;
  });
}

async function menu(call: Call): Promise<Response> {
  return keypad(call, async (rid, digit) => {
    const q = (await call.phone.current(rid)).question;
    const choice = /^[1-9]$/.test(digit) ? q?.answers[Number(digit) - 1] : undefined;
    if (!choice) return null;
    return next(call, await call.phone.answer(rid, choice.send));
  });
}
