import { describe, expect, it } from 'vitest';
import type { Speech, TTS } from '@neighborline/agents';
import type { OutboundNotice } from '../engine/context';
import { ClipStore } from './clips';
import { readPhoneConfig } from './config';
import { createTwilioOutbound, isQuiet, nextAllowed, TwilioOutbound } from './outbound';
import type { TwilioApi } from './twilio-api';

const ENV = { TWILIO_ACCOUNT_SID: 'AC0123456789abcdef0123456789abcdef', TWILIO_AUTH_TOKEN: 'tok', TWILIO_PHONE_NUMBER: '+15035550199', PHONE_PUBLIC_BASE_URL: 'https://line.example' };
const LA = 'America/Los_Angeles';

class FakeApi implements TwilioApi {
  calls: Array<{ to: string; twiml: string }> = [];
  sms: Array<{ to: string; body: string }> = [];
  failCall = false;
  async fetchRecording(): Promise<never> {
    throw new Error('unused');
  }
  async deleteRecording() {}
  async createCall(i: { to: string; twiml: string }) {
    if (this.failCall) throw new Error('busy');
    this.calls.push(i);
    return { sid: `CA${this.calls.length}` };
  }
  async sendSms(i: { to: string; body: string }) {
    this.sms.push(i);
    return { sid: `SM${this.sms.length}` };
  }
}

const notice = (over: Partial<OutboundNotice> = {}): OutboundNotice => ({
  id: 'ntf_1',
  requestId: 'req_1',
  key: 'paid',
  lang: 'es',
  text: 'Ya le enviamos $150.00 a su Venmo. Esperamos que le ayude. Cuídese mucho.',
  textEn: '$150.00 has been sent to your Venmo. We hope it helps. Take care.',
  phone: '+15035550101',
  timezone: LA,
  ...over,
});

function setup(env: Record<string, string> = {}, at = '2026-11-03T18:00:00Z', tts: TTS | null = null) {
  const api = new FakeApi();
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const clips = new ClipStore(Buffer.alloc(32, 2));
  const out = new TwilioOutbound(readPhoneConfig({ ...ENV, ...env }), { api, tts, clips, base: 'https://line.example', now: () => new Date(at), schedule: (ms, fn) => timers.push({ ms, fn }) });
  return { api, out, timers, clips };
}

describe('outbound notify adapter (phone call-backs)', () => {
  it('calls the neighbor and says the payout message in their language, twice', async () => {
    const { api, out } = setup();
    expect(await out.notify(notice())).toMatchObject({ status: 'called', callSid: 'CA1' });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.to).toBe('+15035550101');
    const says = [...api.calls[0]!.twiml.matchAll(/<Say[^>]*language="es-US"[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]);
    expect(says.filter((s) => s === notice().text)).toHaveLength(2);
    expect(api.sms).toHaveLength(0);
  });

  it('is idempotent per notification id', async () => {
    const { api, out } = setup();
    await out.notify(notice());
    expect(await out.notify(notice())).toMatchObject({ status: 'skipped', reason: 'already handled' });
    await out.notify(notice({ id: 'ntf_2', key: 'unclaimed_help' }));
    expect(api.calls).toHaveLength(2);
  });

  it('only rings for payout status (paid, unclaimed help) and only for a callable number', async () => {
    const { api, out } = setup();
    expect(await out.notify(notice({ id: 'a', key: 'confirmed_waiting' }))).toMatchObject({ status: 'skipped' });
    expect(await out.notify(notice({ id: 'b', phone: '266696687' }))).toMatchObject({ status: 'skipped', reason: 'no callable number' });
    expect(api.calls).toHaveLength(0);
  });

  it('waits for morning during quiet hours (21–8 in the group’s time zone)', async () => {
    // 05:30 UTC = 22:30 the evening before in Los Angeles (PDT/PST aware).
    const { api, out, timers } = setup({ PHONE_QUIET_HOURS: '21-8' }, '2026-11-04T05:30:00Z');
    const r = await out.notify(notice());
    expect(r.status).toBe('scheduled');
    expect(new Date(r.at!).toISOString()).toBe('2026-11-04T16:00:00.000Z'); // 08:00 PST
    expect(api.calls).toHaveLength(0);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(Date.parse('2026-11-04T16:00:00Z') - Date.parse('2026-11-04T05:30:00Z'));
    timers[0]!.fn();
    await new Promise((res) => setTimeout(res, 10));
    expect(api.calls).toHaveLength(1);
  });

  it('texts as well only when a verified SMS sender is configured; texts alone if the call fails', async () => {
    const { api, out } = setup({ TWILIO_SMS_FROM: '+18885550100' });
    expect(await out.notify(notice())).toMatchObject({ status: 'called', smsSid: 'SM1' });
    expect(api.sms[0]).toEqual({ to: '+15035550101', body: notice().text });
    api.failCall = true;
    expect(await out.notify(notice({ id: 'ntf_x' }))).toMatchObject({ status: 'texted', smsSid: 'SM2' });
  });

  it('a language without a Twilio voice is played from our TTS via a signed, expiring clip URL', async () => {
    const tts: TTS = { id: 'fake-tts', speak: async (): Promise<Speech> => ({ audio: new Uint8Array([9, 9, 9]), mimeType: 'audio/mpeg', provider: 'fake' }) };
    const { api, out, clips } = setup({}, '2026-11-03T18:00:00Z', tts);
    await out.notify(notice({ lang: 'ht', text: 'Nou voye $60.00 sou Venmo ou.', textEn: '$60.00 has been sent to your Venmo.' }));
    const urls = [...api.calls[0]!.twiml.matchAll(/<Play>([^<]*)<\/Play>/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[0]).toMatch(/^https:\/\/line\.example\/api\/voice\/audio\/[A-Za-z0-9_-]{16}\.\d+\.[A-Za-z0-9_-]{32}$/);
    const token = urls[0]!.split('/').pop()!;
    expect([...clips.get(token)!.audio]).toEqual([9, 9, 9]);
    expect(clips.get(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
  });

  it('is off (null) without the three Twilio settings', () => {
    expect(createTwilioOutbound({}, { tts: null })).toBeNull();
    expect(createTwilioOutbound({ ...ENV, TWILIO_PHONE_NUMBER: '' }, { tts: null })).toBeNull();
    expect(createTwilioOutbound(ENV, { tts: null, api: new FakeApi() })).toBeInstanceOf(TwilioOutbound);
  });

  it('quiet-hour math handles windows across midnight and same-day windows', () => {
    const q = { start: 21, end: 8 };
    expect(isQuiet(new Date('2026-07-01T04:00:00Z'), LA, q)).toBe(true); // 21:00 PDT
    expect(isQuiet(new Date('2026-07-01T15:00:00Z'), LA, q)).toBe(false); // 08:00 PDT
    expect(isQuiet(new Date('2026-07-01T15:00:00Z'), LA, { start: 8, end: 9 })).toBe(true);
    expect(nextAllowed(new Date('2026-07-01T04:10:00Z'), LA, q).toISOString()).toBe('2026-07-01T15:00:00.000Z');
    expect(nextAllowed(new Date('2026-07-01T18:00:00Z'), LA, null).toISOString()).toBe('2026-07-01T18:00:00.000Z');
  });
});
