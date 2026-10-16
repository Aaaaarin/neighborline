/**
 * Phone line configuration (docs/PHONE.md). The line is OFF unless all three Twilio values are set:
 *
 *   TWILIO_ACCOUNT_SID    AC… (Console → Account info)
 *   TWILIO_AUTH_TOKEN     signs every webhook (X-Twilio-Signature) and authenticates REST calls
 *   TWILIO_PHONE_NUMBER   the Twilio number in E.164 (+1…), used as caller ID for call-backs
 *
 * Optional: TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET (REST auth instead of the auth token),
 * TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID (a VERIFIED SMS sender: toll-free verification or
 * A2P 10DLC; without one we never text, only call), PHONE_PUBLIC_BASE_URL (public https origin Twilio
 * calls; defaults to APP_BASE_URL / RENDER_EXTERNAL_URL), PHONE_QUIET_HOURS ("21-8"), PHONE_TIMEZONE,
 * PHONE_BLOCK_ANONYMOUS (default true), PHONE_MAX_CALL_SECONDS (default 600), TWILIO_SAY_VOICES (JSON
 * lang → voice override), PHONE_GREETING_LANGS ("en,es,vi").
 */
import type { Lang } from '@neighborline/core';
import { appBaseUrl, type Env } from '../engine/env';

export interface PhoneConfig {
  enabled: boolean;
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  /** REST basic-auth user/password (API key if set, else account SID + auth token). */
  restUser: string;
  restPassword: string;
  smsFrom: string | null;
  messagingServiceSid: string | null;
  publicBaseUrl: string | null;
  quietHours: { start: number; end: number } | null;
  timezone: string | null;
  blockAnonymous: boolean;
  maxCallSeconds: number;
  /** Seconds of speech per recording (TwiML <Record maxLength>). */
  maxRecordSeconds: number;
  /** Recordings (request + answers + retries) one call may make. */
  maxRecordingsPerCall: number;
  greetingLangs: Lang[];
  voices: Partial<Record<Lang, SayVoice>>;
  restBaseUrl: string;
}

export interface SayVoice {
  /** <Say voice="…"> */
  voice: string;
  /** <Say language="…"> */
  language: string;
}

/**
 * Twilio <Say> voices per language. Format `{Provider}.{Voice}` (twilio.com/docs/voice/twiml/say/text-speech).
 * Haitian Creole has no Twilio voice, so `ht` (and any language missing here) is read with our own TTS and
 * <Play>ed from a short-lived signed URL. Override any entry with TWILIO_SAY_VOICES='{"vi":"Google.vi-VN-Standard-A"}'.
 */
export const DEFAULT_VOICES: Partial<Record<Lang, SayVoice>> = {
  en: { voice: 'Google.en-US-Chirp3-HD-Aoede', language: 'en-US' },
  es: { voice: 'Google.es-US-Chirp3-HD-Aoede', language: 'es-US' },
  vi: { voice: 'Google.vi-VN-Chirp3-HD-Aoede', language: 'vi-VN' },
  zh: { voice: 'Google.cmn-CN-Chirp3-HD-Aoede', language: 'cmn-CN' },
  ar: { voice: 'Google.ar-XA-Chirp3-HD-Aoede', language: 'ar-XA' },
  fr: { voice: 'Google.fr-FR-Chirp3-HD-Aoede', language: 'fr-FR' },
  ko: { voice: 'Google.ko-KR-Chirp3-HD-Aoede', language: 'ko-KR' },
  ru: { voice: 'Google.ru-RU-Chirp3-HD-Aoede', language: 'ru-RU' },
  tl: { voice: 'Google.fil-PH-Standard-A', language: 'fil-PH' },
};

const truthy = (v: string | undefined, dflt: boolean): boolean => {
  if (v === undefined || v.trim() === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
};

const LANG_CODES: readonly string[] = ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'];

/** "21-8" → {start: 21, end: 8}; "off" or "" → null. */
export function parseQuietHours(v: string | undefined): { start: number; end: number } | null {
  const s = (v ?? '21-8').trim().toLowerCase();
  if (!s || s === 'off' || s === 'none') return null;
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(s);
  if (!m) throw new Error(`PHONE_QUIET_HOURS must look like "21-8" (got "${v}")`);
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start > 23 || end > 23 || start === end) throw new Error(`PHONE_QUIET_HOURS hours must be 0–23 and differ (got "${v}")`);
  return { start, end };
}

function parseVoices(raw: string | undefined): Partial<Record<Lang, SayVoice>> {
  const out: Partial<Record<Lang, SayVoice>> = { ...DEFAULT_VOICES };
  if (!raw?.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TWILIO_SAY_VOICES must be JSON, e.g. {"vi":"Google.vi-VN-Standard-A"}');
  }
  for (const [lang, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!LANG_CODES.includes(lang)) continue;
    const l = lang as Lang;
    if (v === null || v === '') delete out[l];
    else if (typeof v === 'string') {
      // "Google.vi-VN-Standard-A" → language vi-VN; "Polly.Lupe-Neural" keeps the default language.
      const loc = /^[A-Za-z]+\.([a-z]{2,3}-[A-Z]{2})/.exec(v)?.[1];
      out[l] = { voice: v, language: loc ?? out[l]?.language ?? 'en-US' };
    } else if (v && typeof v === 'object' && typeof (v as SayVoice).voice === 'string') {
      out[l] = { voice: (v as SayVoice).voice, language: String((v as SayVoice).language ?? out[l]?.language ?? 'en-US') };
    }
  }
  return out;
}

export function readPhoneConfig(env: Env = process.env): PhoneConfig {
  const accountSid = (env.TWILIO_ACCOUNT_SID ?? '').trim();
  const authToken = (env.TWILIO_AUTH_TOKEN ?? '').trim();
  const phoneNumber = (env.TWILIO_PHONE_NUMBER ?? '').trim();
  const keySid = (env.TWILIO_API_KEY_SID ?? '').trim();
  const keySecret = (env.TWILIO_API_KEY_SECRET ?? '').trim();
  const greeting = (env.PHONE_GREETING_LANGS ?? 'en,es,vi')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Lang => LANG_CODES.includes(s));
  const base = (env.PHONE_PUBLIC_BASE_URL || env.APP_BASE_URL || env.RENDER_EXTERNAL_URL || '').trim();
  return {
    enabled: Boolean(accountSid && authToken && phoneNumber),
    accountSid,
    authToken,
    phoneNumber,
    restUser: keySid && keySecret ? keySid : accountSid,
    restPassword: keySid && keySecret ? keySecret : authToken,
    smsFrom: (env.TWILIO_SMS_FROM ?? '').trim() || null,
    messagingServiceSid: (env.TWILIO_MESSAGING_SERVICE_SID ?? '').trim() || null,
    publicBaseUrl: base ? base.replace(/\/$/, '') : null,
    quietHours: parseQuietHours(env.PHONE_QUIET_HOURS),
    timezone: (env.PHONE_TIMEZONE ?? '').trim() || null,
    blockAnonymous: truthy(env.PHONE_BLOCK_ANONYMOUS, true),
    maxCallSeconds: Math.max(60, Number(env.PHONE_MAX_CALL_SECONDS) || 600),
    maxRecordSeconds: 120,
    maxRecordingsPerCall: 5,
    greetingLangs: greeting.length ? greeting : ['en'],
    voices: parseVoices(env.TWILIO_SAY_VOICES),
    restBaseUrl: (env.TWILIO_API_BASE_URL || 'https://api.twilio.com').replace(/\/$/, ''),
  };
}

/** Absolute base URL for links Twilio fetches outside a webhook (call-back <Play> clips). */
export function publicBase(cfg: PhoneConfig, env: Env = process.env): string {
  return cfg.publicBaseUrl ?? appBaseUrl(env);
}

/** For the /call page and /trust: the number to show, or null when the line is off. */
export function hotlineNumber(env: Env = process.env): string | null {
  try {
    const cfg = readPhoneConfig(env);
    return cfg.enabled ? cfg.phoneNumber : null;
  } catch {
    return null;
  }
}

/** "+15035550199" → "(503) 555-0199" for US numbers; anything else unchanged. */
export function displayNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
