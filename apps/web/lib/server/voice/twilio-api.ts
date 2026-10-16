/**
 * The four Twilio REST calls the phone line makes, over fetch with HTTP Basic auth (no SDK):
 *
 *   GET    {RecordingUrl}.mp3                                   download the caller's recording
 *   DELETE /2010-04-01/Accounts/{Sid}/Recordings/{RE…}.json     delete it right after transcription (204)
 *   POST   /2010-04-01/Accounts/{Sid}/Calls.json                call the neighbor back (To, From, Twiml ≤ 4000 chars)
 *   POST   /2010-04-01/Accounts/{Sid}/Messages.json             SMS, only with a verified sender
 *
 * Recording URLs come from a signed webhook, but we still only fetch URLs on api.twilio.com under OUR
 * account's Recordings path (no SSRF through a forged or replayed parameter).
 */
import type { PhoneConfig } from './config';

export interface TwilioApi {
  fetchRecording(recordingUrl: string): Promise<{ audio: Uint8Array; mimeType: string }>;
  deleteRecording(recordingSid: string): Promise<void>;
  createCall(input: { to: string; twiml: string; statusCallback?: string; timeoutSeconds?: number }): Promise<{ sid: string }>;
  sendSms(input: { to: string; body: string }): Promise<{ sid: string }>;
}

export class TwilioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'TwilioApiError';
  }
}

export const RECORDING_SID = /^RE[0-9a-fA-F]{32}$/;
export const MAX_RECORDING_BYTES = 6 * 1024 * 1024;
export const MAX_TWIML_CHARS = 4000;

/** RE… sid from a RecordingUrl, or null when the URL is not one of our account's recordings. */
export function recordingSidFrom(cfg: Pick<PhoneConfig, 'accountSid' | 'restBaseUrl'>, recordingUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(recordingUrl);
  } catch {
    return null;
  }
  const base = new URL(cfg.restBaseUrl);
  if (u.origin !== base.origin) return null;
  const m = /^\/2010-04-01\/Accounts\/([^/]+)\/Recordings\/(RE[0-9a-fA-F]{32})(?:\.(?:wav|mp3|json))?$/.exec(u.pathname);
  if (!m || m[1] !== cfg.accountSid) return null;
  return m[2]!;
}

type Fetch = typeof fetch;

export function createTwilioApi(cfg: PhoneConfig, fetchImpl: Fetch = fetch): TwilioApi {
  const auth = `Basic ${Buffer.from(`${cfg.restUser}:${cfg.restPassword}`).toString('base64')}`;
  const accountPath = `${cfg.restBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}`;

  async function form(path: string, body: Record<string, string>): Promise<{ sid: string }> {
    const res = await fetchImpl(`${accountPath}${path}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !json.sid) throw new TwilioApiError(json.message ?? `Twilio ${path} failed (${res.status})`, res.status, json.code);
    return { sid: json.sid };
  }

  return {
    async fetchRecording(recordingUrl) {
      const sid = recordingSidFrom(cfg, recordingUrl);
      if (!sid) throw new TwilioApiError('Recording URL is not a recording of this account', 400);
      // "may not yet be accessible when the action callback is sent": a few short retries on 404.
      let last = 0;
      for (const wait of [0, 500, 1000, 2000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const res = await fetchImpl(`${accountPath}/Recordings/${sid}.mp3`, { headers: { authorization: auth }, signal: AbortSignal.timeout(20_000) });
        last = res.status;
        if (res.status === 404) continue;
        if (!res.ok) throw new TwilioApiError(`Recording download failed (${res.status})`, res.status);
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_RECORDING_BYTES) throw new TwilioApiError('Recording too large', 413);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > MAX_RECORDING_BYTES) throw new TwilioApiError('Recording too large', 413);
        return { audio: buf, mimeType: 'audio/mpeg' };
      }
      throw new TwilioApiError(`Recording not available (${last})`, last);
    },
    async deleteRecording(recordingSid) {
      if (!RECORDING_SID.test(recordingSid)) throw new TwilioApiError('Bad recording sid', 400);
      const res = await fetchImpl(`${accountPath}/Recordings/${recordingSid}.json`, { method: 'DELETE', headers: { authorization: auth }, signal: AbortSignal.timeout(15_000) });
      // 204 = deleted; 404 = already gone. Both mean the audio no longer exists at Twilio.
      if (res.status !== 204 && res.status !== 404 && !res.ok) throw new TwilioApiError(`Recording delete failed (${res.status})`, res.status);
    },
    async createCall(input) {
      if (input.twiml.length > MAX_TWIML_CHARS) throw new TwilioApiError('TwiML longer than 4000 characters', 400);
      return form('/Calls.json', {
        To: input.to,
        From: cfg.phoneNumber,
        Twiml: input.twiml,
        Timeout: String(input.timeoutSeconds ?? 30),
        ...(input.statusCallback ? { StatusCallback: input.statusCallback } : {}),
      });
    },
    async sendSms(input) {
      const from: Record<string, string> | null = cfg.messagingServiceSid ? { MessagingServiceSid: cfg.messagingServiceSid } : cfg.smsFrom ? { From: cfg.smsFrom } : null;
      if (!from) throw new TwilioApiError('No verified SMS sender configured', 400);
      return form('/Messages.json', { To: input.to, Body: input.body, ...from });
    },
  };
}
