/**
 * The phone line end to end, with simulated Twilio webhooks against the real engine (in-memory PGlite,
 * fake PayPal, fixture AI): call → greeting → <Record> → recording downloaded, transcribed, DELETED at
 * Twilio → read-back in the caller's language → press 1 → filed → two approvals → PayPal SUCCESS →
 * call-back in the caller's language. Plus the abuse and failure paths.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, getRequest } from '@neighborline/db';
import { fixtureAudioBytes } from '@neighborline/agents';
import { eq } from 'drizzle-orm';
import { startHarness, waitFor, type Harness } from './harness';
import { FakeTwilioApi, SimCall, TWILIO_ENV, signedRequest, spoken, voiceTestDeps } from './twilio-sim';
import { handleVoice } from '../lib/server/voice/call-flow';
import { readPhoneConfig } from '../lib/server/voice/config';
import { ClipStore } from '../lib/server/voice/clips';
import { TwilioOutbound } from '../lib/server/voice/outbound';
import { phrase } from '../lib/server/voice/phrases';
import { SharedRateLimiter } from '../lib/server/security/rate-limit';

let h: Harness;
const cfg = readPhoneConfig(TWILIO_ENV);
const api = new FakeTwilioApi(cfg);
// 10:00 in Los Angeles: outside quiet hours whatever they are.
const outbound = new TwilioOutbound(cfg, { api, tts: null, clips: new ClipStore(Buffer.alloc(32, 1)), base: 'https://line.neighborline.test', now: () => new Date('2026-11-03T18:00:00Z') });

beforeAll(async () => {
  h = await startHarness({ outbound });
});
afterAll(async () => {
  await h?.close();
});

const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;
const deps = (opts: Parameters<typeof voiceTestDeps>[1] = {}) => voiceTestDeps(() => h.engine.phone(), { api, ...opts }).deps;
const ridOf = (xml: string) => /rid=(req_[A-Za-z0-9_]+)/.exec(xml)![1]!;
const said = (xml: string) => spoken(xml).map((s) => s.text).join(' ');
const audits = async (rid: string) => (await (await db() as never as { select: () => { from: (t: unknown) => { where: (w: unknown) => Promise<Array<{ action: string; data: Record<string, unknown> }>> } } }).select().from(auditLog).where(eq(auditLog.entityId, rid))).map((r) => r.action);

describe('phone line: inbound call → filed request → call-back', () => {
  it('Mrs. Lan calls, speaks Vietnamese, hears it read back in Vietnamese, presses 1, is called back when paid', async () => {
    const call = new SimCall(deps(), api, '+15035550101');
    const greet = await call.dial();
    expect(greet.status).toBe(200);
    expect(greet.xml).toMatch(/<Record [^>]*maxLength="120"[^>]*playBeep="true"[^>]*trim="trim-silence"/);
    expect(greet.xml).toContain('recordingStatusCallback="/api/voice/recording-status?rid=');
    expect(said(greet.xml)).toContain('After the beep, tell us what you need, in any language.');
    expect(said(greet.xml)).toContain('Después del tono');
    const rid = ridOf(greet.xml);

    const waiting = await call.speak(greet, fixtureAudioBytes('lan_vi'));
    expect(said(waiting.xml)).toContain('One moment');
    const readBack = await call.settle(waiting);
    const lines = spoken(readBack.xml);
    expect(readBack.xml).toMatch(/<Gather input="dtmf" action="\/api\/voice\/confirm\?rid=/);
    expect(lines[0]).toMatchObject({ language: 'vi-VN', voice: 'Google.vi-VN-Chirp3-HD-Aoede' });
    expect(lines[0]!.text).toContain('@lan-nguyen54');
    // She called herself "bà": the prompts around the read-back address her as bà (core address.ts).
    expect(lines[1]!.text).toBe(phrase('confirmPrompt', 'vi', {}, 'bà').text);
    expect(lines[1]!.text).toBe('Nếu đúng, bà bấm số 1. Để nói lại, bà bấm số 2 ạ.');

    // The recording was fetched once and deleted at Twilio after transcription, and the audit log says so.
    const sid = api.fetched.at(-1)!;
    expect(api.deleted).toContain(sid);
    expect(api.recordings.has(sid)).toBe(false);
    expect(await audits(rid)).toEqual(expect.arrayContaining(['phone.call_started', 'audio.deleted', 'phone.recording_deleted']));

    const filed = await call.press(readBack, '1');
    if (process.env.SHOW_TWIML) for (const t of call.log) console.log(t.status, t.xml);
    expect(said(filed.xml)).toContain(phrase('filed', 'vi', {}, 'bà').text);
    expect(said(filed.xml)).toContain('Chúng cháu sẽ gọi hoặc nhắn tin lại cho bà.');
    expect(filed.xml).toContain('<Hangup/>');
    const r = (await getRequest(await db(), rid))!;
    expect(r).toMatchObject({ channel: 'phone', status: 'awaiting_approval', lang: 'vi', contact: { phone: '+15035550101' }, confirmedByRequester: true });
    expect(r.computed).toMatchObject({ amountCents: 15_000, ruleKey: 'utility_outage' });
    const view = (await h.engine.getRequest(rid))!;
    expect(view.requester.area).toBe('by phone');

    // Two organizers approve → PayPal SUCCESS → the engine records "paid" → the line calls her back in Vietnamese.
    await h.engine.approve({ requestIds: [rid], organizerId: 'org_dana', signer: { kind: 'demo_key' } });
    await h.engine.approve({ requestIds: [rid], organizerId: 'org_marcus', signer: { kind: 'demo_key' } });
    const back = await waitFor(() => api.calls.find((c) => c.to === '+15035550101'), 20_000, 'call-back');
    expect(back.twiml).toContain('language="vi-VN"');
    expect(back.twiml).toContain('Chúng cháu đã gửi $150 vào Venmo của bà');
    expect(back.twiml).toContain(phrase('callIntro', 'vi', {}, 'bà').text);
    if (process.env.SHOW_TWIML) console.log(back.twiml);
    expect(back.twiml.length).toBeLessThanOrEqual(4000);
    expect(api.sms).toHaveLength(0); // no verified SMS sender configured → never texts
    expect(api.calls.filter((c) => c.to === '+15035550101')).toHaveLength(1);
  });

  it('missing payout: read-back, "press 1 for Venmo", a second recording, intake re-runs on the combined text', async () => {
    const call = new SimCall(deps(), api, '+15035550102');
    const greet = await call.dial();
    const first = await call.settle(await call.speak(greet, fixtureAudioBytes('missing_payout_es')));
    expect(first.xml).toMatch(/<Gather [^>]*action="\/api\/voice\/payout\?rid=/);
    const lines = said(first.xml);
    expect(lines).toContain('Esto es lo que entendí');
    expect(lines).toContain(phrase('payoutChoice', 'es').text);
    expect(spoken(first.xml)[0]!.language).toBe('es-US');

    const askVenmo = await call.press(first, '1');
    expect(said(askVenmo.xml)).toContain(phrase('sayVenmo', 'es').text);
    const second = await call.settle(await call.speak(askVenmo, new Uint8Array(2000).fill(3)));
    expect(second.xml).toMatch(/action="\/api\/voice\/confirm\?rid=/);
    expect(said(second.xml)).toContain('@caller-');
    const rid = ridOf(second.xml);
    const t = (await h.engine.getThread(rid))!;
    expect(t.messages.some((m) => m.from === 'neighbor' && m.kind === 'voice' && m.text.startsWith('@caller-'))).toBe(true);

    const filed = await call.press(second, '1');
    expect(said(filed.xml)).toContain(phrase('filed', 'es').text);
    expect((await getRequest(await db(), rid))!.status).toBe('awaiting_approval');
    expect(api.deleted.length).toBeGreaterThanOrEqual(2);
  });

  it('press 2 to try again records once more; no key twice ends the call politely', async () => {
    const call = new SimCall(deps(), api, '+15035550103');
    const readBack = await call.settle(await call.speak(await call.dial(), fixtureAudioBytes('walter_en')));
    const again = await call.press(readBack, '2');
    expect(said(again.xml)).toContain(phrase('tryAgain', 'en').text);
    expect(again.xml).toContain('kind=retry');
    const rid = ridOf(again.xml);
    expect((await getRequest(await db(), rid))!.status).toBe('needs_clarification');

    const second = await call.settle(await call.speak(again, new Uint8Array(500)));
    expect(second.xml).toMatch(/action="\/api\/voice\/confirm/);
    const r1 = await call.silence(second);
    expect(r1.xml).toMatch(/<Gather/);
    const r2 = await call.silence(r1);
    const r3 = await call.silence(r2);
    expect(said(r3.xml)).toContain(phrase('gaveUp', 'en').text);
    expect(r3.xml).toContain('<Hangup/>');
  });

  it('Haitian Creole: no Twilio voice, fixture TTS has no audio → the English rendering, never silence', async () => {
    const call = new SimCall(deps(), api, '+15035550104');
    const readBack = await call.settle(await call.speak(await call.dial(), fixtureAudioBytes('jean_ht')));
    const lines = spoken(readBack.xml);
    expect(lines[0]!.language).toBe('en-US');
    expect(lines[0]!.text).toMatch(/^Here is what I understood/);
    expect(lines[0]!.text).toContain('@jean-baptiste-h');
    expect(lines[1]!.text).toBe(phrase('confirmPrompt', 'en').text);
  });

  it('a lookalike payout handle and hidden instructions are stopped at intake: no confirm prompt, just the rail reply', async () => {
    const call = new SimCall(deps(), api, '+15035550105');
    const out = await call.settle(await call.speak(await call.dial(), fixtureAudioBytes('inject_en')));
    expect(out.xml).not.toContain('<Gather');
    expect(out.xml).toContain('<Hangup/>');
    const rid = /rid=(req_\w+)/.exec(call.log[0]!.xml)![1]!;
    const r = (await getRequest(await db(), rid))!;
    expect(r.status).toBe('awaiting_approval');
    expect(r.railFlags.map((f) => f.code)).toEqual(expect.arrayContaining(['LOOKALIKE_HANDLE', 'PROMPT_INJECTION']));
  });

  it('an empty recording asks again; a hang-up during the recording is never transcribed, and both are deleted', async () => {
    const call = new SimCall(deps(), api, '+15035550106');
    const greet = await call.dial();
    const rid = ridOf(greet.xml);
    const empty = await call.speak(greet, new Uint8Array(0), { duration: 0 });
    expect(said(empty.xml)).toContain(phrase('notHeard', 'en').text);
    expect(empty.xml).toContain('n=2');
    const emptySid = api.created.at(-1)!;
    expect(api.fetched).not.toContain(emptySid);
    expect(api.deleted).toContain(emptySid);

    const gone = await call.speak(empty, fixtureAudioBytes('lan_vi'), { hangup: true });
    const hungUpSid = api.created.at(-1)!;
    expect(gone.status).toBe(204);
    expect(api.fetched).not.toContain(hungUpSid);
    expect(api.deleted).toContain(hungUpSid);
    expect(api.recordings.has(hungUpSid)).toBe(false);
    expect((await getRequest(await db(), rid))!.originalText).toBe('');
  });

  it('a question with fixed answers becomes a keypad menu in the caller\'s language', async () => {
    const phone = await h.engine.phone();
    const { requestId: rid } = await phone.start({ callerPhone: '+15035550108' });
    await phone.answer(rid, 'I need some help please. My Venmo is @quick-phone1');
    const call = new SimCall(deps(), api, '+15035550108');
    const menu = await call.post(`/api/voice/menu?rid=${rid}&r=0&none=1`);
    expect(menu.xml).toMatch(/<Gather [^>]*action="\/api\/voice\/menu\?rid=/);
    const options = spoken(menu.xml).map((l) => l.text);
    const groceries = options.findIndex((t) => /^For Groceries, press \d\.$/.test(t));
    expect(groceries).toBeGreaterThan(0);
    const digit = /press (\d)/.exec(options[groceries]!)![1]!;
    const next = await call.press(menu, digit);
    expect(next.xml).toMatch(/<Gather|<Record/);
    expect((await getRequest(await db(), rid))!.extracted?.category).toBe('groceries');
  });

  it('works when the recording status callback arrives before the action', async () => {
    const call = new SimCall(deps(), api, '+15035550107');
    const t = await call.settle(await call.speak(await call.dial(), fixtureAudioBytes('walter_en'), { statusFirst: true }));
    expect(t.xml).toMatch(/action="\/api\/voice\/confirm/);
  });
});

describe('phone line: who may call, and for how long', () => {
  it('rejects an unsigned, wrongly signed or other-account webhook with 403, and is 404 when not configured', async () => {
    const d = deps();
    const params = { AccountSid: TWILIO_ENV.TWILIO_ACCOUNT_SID, CallSid: 'CA1', From: '+15035550110', To: TWILIO_ENV.TWILIO_PHONE_NUMBER };
    expect((await handleVoice('incoming', signedRequest('/api/voice/incoming', params, { signature: '' }), d)).status).toBe(403);
    expect((await handleVoice('incoming', signedRequest('/api/voice/incoming', params, { token: 'someone-elses-token' }), d)).status).toBe(403);
    expect((await handleVoice('incoming', signedRequest('/api/voice/incoming', { ...params, AccountSid: 'ACffffffffffffffffffffffffffffffff' }), d)).status).toBe(403);
    // A valid signature over different parameters than the ones sent (tampered body).
    const req = signedRequest('/api/voice/incoming', params);
    const tampered = new Request(req.url, { method: 'POST', headers: req.headers, body: new URLSearchParams({ ...params, From: '+15035550999' }).toString() });
    expect((await handleVoice('incoming', tampered, d)).status).toBe(403);
    expect((await handleVoice('incoming', signedRequest('/api/voice/incoming', params), d)).status).toBe(200);
    const off = voiceTestDeps(() => h.engine.phone(), { env: { TWILIO_AUTH_TOKEN: '' } }).deps;
    expect((await handleVoice('incoming', signedRequest('/api/voice/incoming', params), off)).status).toBe(404);
  });

  it('withheld numbers are asked to call again without hiding their number (PHONE_BLOCK_ANONYMOUS, default on)', async () => {
    for (const from of ['+266696687', 'Anonymous', '+7378742833', '']) {
      const t = await new SimCall(deps(), api, from).dial();
      expect(said(t.xml)).toContain(phrase('anonymous', 'en').text);
      expect(t.xml).not.toContain('<Record');
    }
    const allowed = await new SimCall(deps({ env: { PHONE_BLOCK_ANONYMOUS: 'false' } }), api, '+266696687').dial();
    expect(allowed.xml).toContain('<Record');
  });

  it('rate-limits per calling number (4 calls, then one per 15 minutes)', async () => {
    let now = Date.parse('2026-11-03T18:00:00Z');
    const d = deps({ env: { RATE_LIMITS: 'on' }, now: () => now });
    const dial = () => new SimCall(d, api, '+15035550120').dial();
    for (let i = 0; i < 4; i++) expect((await dial()).xml).toContain('<Record');
    const fifth = await dial();
    expect(said(fifth.xml)).toContain(phrase('tooMany', 'en').text);
    expect((await new SimCall(d, api, '+15035550121').dial()).xml).toContain('<Record'); // other callers unaffected
    now += 15 * 60_000;
    expect((await dial()).xml).toContain('<Record');
  });

  it('the per-caller limit is shared by every web instance on the same database (THREAT_MODEL R9)', async () => {
    let now = Date.parse('2026-11-03T19:00:00Z');
    const secret = () => Buffer.alloc(32, 9);
    const [a, b] = [new SharedRateLimiter(() => now, secret), new SharedRateLimiter(() => now, secret)];
    a.attach(await db());
    b.attach(await db());
    const on = (limiter: SharedRateLimiter) => deps({ env: { RATE_LIMITS: 'on' }, now: () => now, limiter });
    const [da, dbb] = [on(a), on(b)];
    const dial = (d: typeof da) => new SimCall(d, api, '+15035550125').dial();
    for (const d of [da, dbb, da, dbb]) expect((await dial(d)).xml).toContain('<Record');
    expect(said((await dial(da)).xml)).toContain(phrase('tooMany', 'en').text);
    expect(said((await dial(dbb)).xml)).toContain(phrase('tooMany', 'en').text);
    now += 15 * 60_000;
    expect((await dial(dbb)).xml).toContain('<Record');
  });

  it('ends a call that runs past PHONE_MAX_CALL_SECONDS', async () => {
    let now = Date.now();
    const call = new SimCall(deps({ now: () => now }), api, '+15035550130');
    const greet = await call.dial();
    now += 601_000;
    const t = await call.speak(greet, fixtureAudioBytes('walter_en'));
    expect(said(t.xml)).toContain(phrase('tooLong', 'en').text);
    expect(t.xml).toContain('<Hangup/>');
  });

  it('a request id only works for the number that created it', async () => {
    const owner = new SimCall(deps(), api, '+15035550140');
    const greet = await owner.dial();
    const rid = ridOf(greet.xml);
    const intruder = new SimCall(deps(), api, '+15035550141');
    const t = await intruder.post(`/api/voice/confirm?rid=${rid}&r=0`, { Digits: '1' });
    expect(said(t.xml)).toContain(phrase('trouble', 'en').text);
    expect((await getRequest(await db(), rid))!.status).toBe('intake');
  });
});
