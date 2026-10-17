/**
 * A simulated Twilio for phone-line tests: a fake REST API (recordings, deletes, calls, SMS) and a call
 * driver that sends correctly signed webhooks the way Twilio does, following <Redirect>, <Record> and
 * <Gather> in the TwiML we return. No network, no Twilio account.
 */
import { randomBytes } from 'node:crypto';
import type { PhoneIntake } from '../lib/server/voice/bridge';
import { handleVoice, type VoiceDeps } from '../lib/server/voice/call-flow';
import { CallClock, JobStore } from '../lib/server/voice/calls';
import { ClipStore } from '../lib/server/voice/clips';
import { readPhoneConfig, type PhoneConfig } from '../lib/server/voice/config';
import { expectedSignature } from '../lib/server/voice/signature';
import { recordingSidFrom, type TwilioApi } from '../lib/server/voice/twilio-api';
import { RateLimiter, type TokenLimiter } from '../lib/server/security/rate-limit';

export const TEST_ACCOUNT = 'AC0123456789abcdef0123456789abcdef';
export const TEST_TOKEN = 'test_auth_token_0123456789abcdef';
export const LINE_NUMBER = '+15035550199';
export const PUBLIC_BASE = 'https://line.neighborline.test';

export const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: TEST_ACCOUNT,
  TWILIO_AUTH_TOKEN: TEST_TOKEN,
  TWILIO_PHONE_NUMBER: LINE_NUMBER,
  PHONE_PUBLIC_BASE_URL: PUBLIC_BASE,
  PHONE_QUIET_HOURS: 'off',
} as const;

export class FakeTwilioApi implements TwilioApi {
  readonly recordings = new Map<string, Uint8Array>();
  readonly created: string[] = [];
  readonly fetched: string[] = [];
  readonly deleted: string[] = [];
  readonly calls: Array<{ to: string; twiml: string; sid: string }> = [];
  readonly sms: Array<{ to: string; body: string; sid: string }> = [];
  failCalls = false;
  constructor(private readonly cfg: PhoneConfig) {}

  newRecording(audio: Uint8Array): { sid: string; url: string } {
    const sid = `RE${randomBytes(16).toString('hex')}`;
    this.recordings.set(sid, audio);
    this.created.push(sid);
    return { sid, url: `${this.cfg.restBaseUrl}/2010-04-01/Accounts/${this.cfg.accountSid}/Recordings/${sid}` };
  }

  async fetchRecording(url: string) {
    const sid = recordingSidFrom(this.cfg, url);
    if (!sid) throw new Error('not our recording');
    this.fetched.push(sid);
    const a = this.recordings.get(sid);
    if (!a) throw new Error(`no recording ${sid}`);
    return { audio: new Uint8Array(a), mimeType: 'audio/mpeg' };
  }
  async deleteRecording(sid: string) {
    this.deleted.push(sid);
    this.recordings.delete(sid);
  }
  async createCall(input: { to: string; twiml: string }) {
    if (this.failCalls) throw new Error('Twilio said no');
    const sid = `CA${randomBytes(16).toString('hex')}`;
    this.calls.push({ to: input.to, twiml: input.twiml, sid });
    return { sid };
  }
  async sendSms(input: { to: string; body: string }) {
    const sid = `SM${randomBytes(16).toString('hex')}`;
    this.sms.push({ ...input, sid });
    return { sid };
  }
}

export function voiceTestDeps(phone: () => Promise<PhoneIntake>, opts: { env?: Record<string, string>; now?: () => number; api?: FakeTwilioApi; limiter?: TokenLimiter } = {}) {
  const env = { ...TWILIO_ENV, RATE_LIMITS: 'off', ...(opts.env ?? {}) };
  const cfg = readPhoneConfig(env);
  const api = opts.api ?? new FakeTwilioApi(cfg);
  const deps: VoiceDeps = {
    cfg,
    env,
    phone,
    api,
    clips: new ClipStore(Buffer.alloc(32, 7)),
    jobs: new JobStore(),
    calls: new CallClock(opts.now),
    limiter: opts.limiter ?? new RateLimiter(opts.now),
  };
  return { deps, api, cfg };
}

/** A webhook request exactly as Twilio would send it (form body + X-Twilio-Signature over the public URL). */
export function signedRequest(path: string, params: Record<string, string>, opts: { token?: string; signature?: string } = {}): Request {
  const url = `${PUBLIC_BASE}${path}`;
  const sig = opts.signature ?? expectedSignature(opts.token ?? TEST_TOKEN, url, params);
  // Behind the proxy the app sees its internal address; signature validation must use the public URL.
  return new Request(`http://127.0.0.1:3980${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-twilio-signature': sig },
    body: new URLSearchParams(params).toString(),
  });
}

export interface Turn {
  status: number;
  xml: string;
}

const attr = (tag: string, name: string): string | null => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]?.replace(/&amp;/g, '&') ?? null;

export class SimCall {
  readonly callSid = `CA${randomBytes(16).toString('hex')}`;
  readonly log: Turn[] = [];
  constructor(
    readonly deps: VoiceDeps,
    readonly api: FakeTwilioApi,
    readonly from: string,
  ) {}

  private base(): Record<string, string> {
    return { AccountSid: TEST_ACCOUNT, CallSid: this.callSid, From: this.from, To: LINE_NUMBER, Caller: this.from, Called: LINE_NUMBER, Direction: 'inbound', CallStatus: 'in-progress', ApiVersion: '2010-04-01' };
  }

  async post(path: string, extra: Record<string, string> = {}): Promise<Turn> {
    const step = path.split('?')[0]!.replace('/api/voice/', '');
    const res = await handleVoice(step, signedRequest(path, { ...this.base(), ...extra }), this.deps);
    const t = { status: res.status, xml: await res.text() };
    this.log.push(t);
    return t;
  }

  async dial(): Promise<Turn> {
    return this.post('/api/voice/incoming', { CallStatus: 'ringing' });
  }

  /** Answer the <Record> in `t` with `audio`: action first (as Twilio does), then the recording status callback. */
  async speak(t: Turn, audio: Uint8Array, opts: { duration?: number; hangup?: boolean; statusFirst?: boolean } = {}): Promise<Turn> {
    const tag = /<Record [^>]*\/>/.exec(t.xml)?.[0];
    if (!tag) throw new Error(`no <Record> in ${t.xml}`);
    const rec = this.api.newRecording(audio);
    const duration = String(opts.duration ?? 9);
    const action = () => this.post(attr(tag, 'action')!, { RecordingUrl: rec.url, RecordingDuration: duration, RecordingSid: rec.sid, Digits: opts.hangup ? 'hangup' : '#' });
    const status = () =>
      this.post(attr(tag, 'recordingStatusCallback')!, { RecordingSid: rec.sid, RecordingUrl: rec.url, RecordingStatus: 'completed', RecordingDuration: duration, RecordingChannels: '1', RecordingSource: 'RecordVerb' });
    if (opts.statusFirst) {
      await status();
      return action();
    }
    const out = await action();
    await status();
    return out;
  }

  /** Follow <Redirect>s (the "one moment" wait loop) until the TwiML asks the caller for something. */
  async settle(t: Turn, max = 200): Promise<Turn> {
    let cur = t;
    for (let i = 0; i < max; i++) {
      const r = /<Redirect[^>]*>([^<]*)<\/Redirect>/.exec(cur.xml);
      if (!r || /<Gather /.test(cur.xml) || /<Record /.test(cur.xml)) return cur;
      await new Promise((res) => setTimeout(res, 20));
      cur = await this.post(r[1]!.replace(/&amp;/g, '&'));
    }
    throw new Error('wait loop did not settle');
  }

  /** Press a key on the current <Gather>. */
  async press(t: Turn, digits: string): Promise<Turn> {
    const tag = /<Gather [^>]*>/.exec(t.xml)?.[0];
    if (!tag) throw new Error(`no <Gather> in ${t.xml}`);
    return this.post(attr(tag, 'action')!, { Digits: digits });
  }

  /** Let the <Gather> time out (Twilio falls through to the <Redirect> after it). */
  async silence(t: Turn): Promise<Turn> {
    const r = /<\/Gather><Redirect[^>]*>([^<]*)<\/Redirect>/.exec(t.xml);
    if (!r) throw new Error(`no fall-through redirect in ${t.xml}`);
    return this.post(r[1]!.replace(/&amp;/g, '&'));
  }
}

/** All the text the caller hears in a TwiML turn, with the voice/language of each <Say>. */
export function spoken(xml: string): Array<{ text: string; language: string | null; voice: string | null }> {
  return [...xml.matchAll(/<Say([^>]*)>([^<]*)<\/Say>/g)].map((m) => ({
    text: m[2]!.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    language: attr(m[1]!, 'language'),
    voice: attr(m[1]!, 'voice'),
  }));
}
