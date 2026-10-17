/**
 * Outbound notify adapter (engine Ctx.outbound): when the engine records a payout-status message for a
 * neighbor who called in (contact.phone), call them back and say it in their language.
 *
 *   - Voice first: a call needs no carrier sender registration. <Say> in their language when Twilio has
 *     a voice for it, else our TTS played from a signed URL (30-minute clip), else the English rendering.
 *   - SMS only when a VERIFIED sender is configured (TWILIO_SMS_FROM / TWILIO_MESSAGING_SERVICE_SID): US
 *     carriers block unregistered 10DLC (error 30034) and unverified toll-free (30032) traffic.
 *   - Quiet hours (PHONE_QUIET_HOURS, default 21–8 in the group's time zone): delivery waits for morning.
 *   - Idempotent per notification id: a replayed webhook or a retried job never rings twice.
 */
import type { Lang } from '@neighborline/core';
import type { TTS } from '@neighborline/agents';
import type { OutboundNotice, OutboundNotifier } from '../engine/context';
import type { Env } from '../engine/env';
import { errorText, log } from '../log';
import { clipStore, type ClipStore } from './clips';
import { publicBase, readPhoneConfig, type PhoneConfig } from './config';
import { phrase } from './phrases';
import { createSpeaker } from './speech';
import { createTwilioApi, MAX_TWIML_CHARS, type TwilioApi } from './twilio-api';
import { pause, response } from './twiml';

/** Message keys that ring the neighbor's phone (payout status). Others stay in the thread. */
export const OUTBOUND_KEYS: readonly string[] = ['paid', 'unclaimed_help'];
const DEFAULT_TZ = 'America/Los_Angeles';

export interface OutboundResult {
  /** called = the call was placed (SMS may also have gone); texted = only the SMS went; failed = neither. */
  status: 'called' | 'texted' | 'scheduled' | 'skipped' | 'failed';
  reason?: string;
  callSid?: string;
  smsSid?: string;
  /** For 'scheduled': when delivery will happen. */
  at?: string;
}

export function localHour(at: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at);
  return Number(h) % 24;
}

export function isQuiet(at: Date, timeZone: string, q: { start: number; end: number } | null): boolean {
  if (!q) return false;
  const h = localHour(at, timeZone);
  return q.start > q.end ? h >= q.start || h < q.end : h >= q.start && h < q.end;
}

/** The first quarter hour at or after `at` that is outside quiet hours (DST-safe: walks real time). */
export function nextAllowed(at: Date, timeZone: string, q: { start: number; end: number } | null): Date {
  if (!isQuiet(at, timeZone, q)) return at;
  let t = new Date(Math.ceil(at.getTime() / 900_000) * 900_000);
  for (let i = 0; i < 4 * 26 && isQuiet(t, timeZone, q); i++) t = new Date(t.getTime() + 900_000);
  return t;
}

export interface OutboundDeps {
  api: TwilioApi;
  tts: TTS | null;
  clips: ClipStore;
  base: string;
  now?: () => Date;
  schedule?: (ms: number, fn: () => void) => void;
}

export class TwilioOutbound implements OutboundNotifier {
  private readonly done = new Map<string, Promise<OutboundResult>>();
  private readonly now: () => Date;
  private readonly schedule: (ms: number, fn: () => void) => void;

  constructor(
    private readonly cfg: PhoneConfig,
    private readonly deps: OutboundDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
    this.schedule = deps.schedule ?? ((ms, fn) => setTimeout(fn, ms).unref?.());
  }

  notify(n: OutboundNotice): Promise<OutboundResult> {
    const prior = this.done.get(n.id);
    if (prior) return prior.then((r) => ({ ...r, status: r.status === 'failed' ? 'failed' : 'skipped', reason: 'already handled' }) as OutboundResult);
    const p = this.handle(n);
    this.done.set(n.id, p);
    if (this.done.size > 5000) this.done.delete(this.done.keys().next().value!);
    return p;
  }

  private async handle(n: OutboundNotice): Promise<OutboundResult> {
    if (!OUTBOUND_KEYS.includes(n.key)) return { status: 'skipped', reason: `not a phone notice (${n.key})` };
    if (!/^\+[1-9]\d{7,14}$/.test(n.phone)) return { status: 'skipped', reason: 'no callable number' };
    const tz = this.cfg.timezone ?? n.timezone ?? DEFAULT_TZ;
    const now = this.now();
    const when = nextAllowed(now, tz, this.cfg.quietHours);
    if (when.getTime() > now.getTime()) {
      this.schedule(when.getTime() - now.getTime(), () => {
        this.deliver(n).catch(() => {});
      });
      log.info('voice.outbound_scheduled', { requestId: n.requestId, key: n.key, at: when.toISOString() });
      return { status: 'scheduled', at: when.toISOString() };
    }
    return this.deliver(n);
  }

  /** Builds the call's TwiML: intro, the message, how to hear it again, the message once more. */
  async twiml(n: Pick<OutboundNotice, 'lang' | 'text' | 'textEn' | 'addressForm'>): Promise<string> {
    const speaker = createSpeaker(this.cfg, { tts: this.deps.tts, clips: this.deps.clips, base: this.deps.base });
    const p = (key: 'callIntro' | 'callAgain', lang: Lang) => {
      const ph = phrase(key, lang, {}, n.addressForm);
      return speaker.speak(ph.text, ph.lang, { textEn: phrase(key, 'en').text, clipTtlMs: 30 * 60_000 });
    };
    const message = await speaker.speak(n.text, n.lang, { textEn: n.textEn, clipTtlMs: 30 * 60_000 });
    const full = response(pause(1), await p('callIntro', n.lang), message, pause(1), await p('callAgain', n.lang), pause(1), message);
    return full.length <= MAX_TWIML_CHARS ? full : response(pause(1), message);
  }

  private async deliver(n: OutboundNotice): Promise<OutboundResult> {
    const out: OutboundResult = { status: 'called' };
    try {
      const call = await this.deps.api.createCall({ to: n.phone, twiml: await this.twiml(n), timeoutSeconds: 30 });
      out.callSid = call.sid;
    } catch (err) {
      log.error('voice.outbound_call_failed', { requestId: n.requestId, key: n.key, error: errorText(err) });
      out.status = 'failed';
      out.reason = errorText(err);
    }
    if (this.cfg.smsFrom || this.cfg.messagingServiceSid) {
      try {
        out.smsSid = (await this.deps.api.sendSms({ to: n.phone, body: n.text })).sid;
        if (out.status === 'failed') {
          out.status = 'texted';
          delete out.reason;
        }
      } catch (err) {
        log.error('voice.outbound_sms_failed', { requestId: n.requestId, key: n.key, error: errorText(err) });
      }
    }
    log.info('voice.outbound_sent', { requestId: n.requestId, key: n.key, status: out.status, sms: Boolean(out.smsSid) });
    return out;
  }
}

/** The engine's outbound adapter from env: null (no phone calls) unless the Twilio number is configured. */
export function createTwilioOutbound(env: Env, deps: { tts: TTS | null; api?: TwilioApi }): TwilioOutbound | null {
  let cfg: PhoneConfig;
  try {
    cfg = readPhoneConfig(env);
  } catch (err) {
    log.error('voice.config_invalid', { error: errorText(err) });
    return null;
  }
  if (!cfg.enabled) return null;
  return new TwilioOutbound(cfg, { api: deps.api ?? createTwilioApi(cfg), tts: deps.tts, clips: clipStore(cfg.authToken), base: publicBase(cfg, env) });
}
