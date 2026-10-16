import { describe, expect, it } from 'vitest';
import { readPhoneConfig } from './config';
import { createTwilioApi, recordingSidFrom } from './twilio-api';

const env = { TWILIO_ACCOUNT_SID: 'AC0123456789abcdef0123456789abcdef', TWILIO_AUTH_TOKEN: 'tok', TWILIO_PHONE_NUMBER: '+15035550199' };
const SID = 'RE0123456789abcdef0123456789abcdef';
const REC = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${SID}`;

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { f, seen };
}

describe('Twilio REST client', () => {
  const cfg = readPhoneConfig(env);

  it('only downloads recordings of this account on api.twilio.com (no SSRF via RecordingUrl)', () => {
    expect(recordingSidFrom(cfg, REC)).toBe(SID);
    expect(recordingSidFrom(cfg, `${REC}.mp3`)).toBe(SID);
    expect(recordingSidFrom(cfg, REC.replace('api.twilio.com', 'evil.example'))).toBeNull();
    expect(recordingSidFrom(cfg, REC.replace(env.TWILIO_ACCOUNT_SID, 'ACffffffffffffffffffffffffffffffff'))).toBeNull();
    expect(recordingSidFrom(cfg, 'http://169.254.169.254/latest')).toBeNull();
    expect(recordingSidFrom(cfg, 'not a url')).toBeNull();
  });

  it('downloads the mp3 with Basic auth, retrying while Twilio still says 404', async () => {
    let n = 0;
    const { f, seen } = fakeFetch(() => (++n < 2 ? new Response('', { status: 404 }) : new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const api = createTwilioApi(cfg, f);
    const r = await api.fetchRecording(REC);
    expect([...r.audio]).toEqual([1, 2, 3]);
    expect(r.mimeType).toBe('audio/mpeg');
    expect(seen[0]!.url).toBe(`${REC}.mp3`);
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:tok`).toString('base64')}`);
    await expect(api.fetchRecording(REC.replace('api.twilio.com', 'evil.example'))).rejects.toThrow(/not a recording of this account/);
  });

  it('uses an API key for REST auth when one is set', async () => {
    const { f, seen } = fakeFetch(() => new Response(null, { status: 204 }));
    await createTwilioApi(readPhoneConfig({ ...env, TWILIO_API_KEY_SID: 'SKkey', TWILIO_API_KEY_SECRET: 'secret' }), f).deleteRecording(SID);
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('SKkey:secret').toString('base64')}`);
  });

  it('deletes with DELETE …/Recordings/RE….json; 204 and 404 both mean gone', async () => {
    const { f, seen } = fakeFetch((url) => new Response(null, { status: url.includes('dead') ? 500 : 204 }));
    const api = createTwilioApi(cfg, f);
    await api.deleteRecording(SID);
    expect(seen[0]).toMatchObject({ url: `${REC}.json`, init: { method: 'DELETE' } });
    await createTwilioApi(cfg, fakeFetch(() => new Response(null, { status: 404 })).f).deleteRecording(SID);
    await expect(api.deleteRecording('RE../../Calls')).rejects.toThrow(/Bad recording sid/);
    await expect(createTwilioApi(cfg, fakeFetch(() => new Response(null, { status: 500 })).f).deleteRecording(SID)).rejects.toThrow(/500/);
  });

  it('places a call with inline TwiML from our number, and refuses TwiML over 4000 characters', async () => {
    const { f, seen } = fakeFetch(() => Response.json({ sid: 'CA123' }, { status: 201 }));
    const api = createTwilioApi(cfg, f);
    expect(await api.createCall({ to: '+15035550101', twiml: '<Response><Say>Hi</Say></Response>' })).toEqual({ sid: 'CA123' });
    expect(seen[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`);
    const body = new URLSearchParams(String(seen[0]!.init.body));
    expect(Object.fromEntries(body)).toMatchObject({ To: '+15035550101', From: '+15035550199', Twiml: '<Response><Say>Hi</Say></Response>', Timeout: '30' });
    await expect(api.createCall({ to: '+15035550101', twiml: 'x'.repeat(4001) })).rejects.toThrow(/4000/);
  });

  it('texts only with a verified sender (messaging service preferred), and surfaces Twilio errors', async () => {
    await expect(createTwilioApi(cfg, fakeFetch(() => Response.json({ sid: 'SM1' })).f).sendSms({ to: '+1', body: 'x' })).rejects.toThrow(/No verified SMS sender/);
    const { f, seen } = fakeFetch(() => Response.json({ sid: 'SM1' }, { status: 201 }));
    await createTwilioApi(readPhoneConfig({ ...env, TWILIO_MESSAGING_SERVICE_SID: 'MG1', TWILIO_SMS_FROM: '+18885550100' }), f).sendSms({ to: '+15035550101', body: 'hola' });
    expect(Object.fromEntries(new URLSearchParams(String(seen[0]!.init.body)))).toEqual({ To: '+15035550101', Body: 'hola', MessagingServiceSid: 'MG1' });
    const bad = createTwilioApi(readPhoneConfig({ ...env, TWILIO_SMS_FROM: '+18885550100' }), fakeFetch(() => Response.json({ code: 21211, message: "Invalid 'To' Phone Number" }, { status: 400 })).f);
    await expect(bad.sendSms({ to: '+1', body: 'x' })).rejects.toMatchObject({ code: 21211, status: 400 });
  });
});
