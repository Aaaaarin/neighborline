/**
 * Judge isolation, privacy of public reads, cross-site protection and rate limits
 * (QA-REPORT-1 P1-3, P1-4, P1-7, P2-1, P2-9). Pure units first, then the engine end to end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertJson, crossSiteProblem, readCapped } from '../lib/server/security/guard';
import { RateLimiter, clientIp, enforceLimit, limiter } from '../lib/server/security/rate-limit';
import { redactRequestView, redactText, streamMessageFor, viewsFor } from '../lib/server/security/redact';
import { accessTo, ownsAll, type Viewer } from '../lib/server/security/viewer';
import { decodeVisitor, demoRunId, encodeVisitor, ownerTagOf, visitorRequestId, visitorTag } from '../lib/server/security/visitor';
import type { RequestView, StreamMessage } from '../lib/types';
import { startHarness, waitFor, type Harness } from './harness';

const post = (headers: Record<string, string>, path = '/api/intake/x/text') => new Request(`http://localhost:3000${path}`, { method: 'POST', headers });

describe('cross-site requests (guard.ts)', () => {
  it('refuses cross-site browser POSTs, allows same-origin and non-browser callers', () => {
    expect(crossSiteProblem(post({ 'sec-fetch-site': 'cross-site' }))).toMatch(/cross-site/);
    expect(crossSiteProblem(post({ origin: 'https://evil.example' }))).toMatch(/evil/);
    expect(crossSiteProblem(post({ origin: 'null' }))).toMatch(/null/);
    expect(crossSiteProblem(post({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000' }))).toBeNull();
    expect(crossSiteProblem(post({}))).toBeNull(); // curl, server-to-server: no ambient cookies to ride
    expect(crossSiteProblem(new Request('http://localhost:3000/api/requests', { headers: { 'sec-fetch-site': 'cross-site' } }))).toBeNull(); // GET
  });
  it('exempts PayPal webhooks and HMAC-signed internal jobs (they authenticate themselves)', () => {
    expect(crossSiteProblem(post({ origin: 'https://evil.example' }, '/api/webhooks/paypal'))).toBeNull();
    expect(crossSiteProblem(post({ origin: 'https://evil.example' }, '/api/internal/reconcile'))).toBeNull();
    expect(crossSiteProblem(post({ origin: 'https://evil.example' }, '/api/demo/reset'))).not.toBeNull();
  });
  it('accepts the configured public origin behind a proxy', () => {
    const req = new Request('http://10.0.0.5:3000/api/approvals', { method: 'POST', headers: { origin: 'https://neighborline.onrender.com', host: '10.0.0.5:3000' } });
    expect(crossSiteProblem(req, { APP_BASE_URL: 'https://neighborline.onrender.com' })).toBeNull();
    expect(crossSiteProblem(req, {})).not.toBeNull();
  });
  it('requires application/json and caps body size', async () => {
    expect(() => assertJson(post({ 'content-type': 'text/plain' }))).toThrow(/application\/json/);
    expect(() => assertJson(post({ 'content-type': 'application/x-www-form-urlencoded' }))).toThrow();
    expect(() => assertJson(post({ 'content-type': 'application/json; charset=utf-8' }))).not.toThrow();
    const big = new Request('http://localhost:3000/x', { method: 'POST', body: 'x'.repeat(70 * 1024) });
    await expect(readCapped(big)).rejects.toMatchObject({ status: 413 });
    const lying = new Request('http://localhost:3000/x', { method: 'POST', body: 'x'.repeat(70 * 1024), headers: { 'content-length': '10' } });
    await expect(readCapped(lying)).rejects.toMatchObject({ status: 413 });
    expect(await readCapped(new Request('http://localhost:3000/x', { method: 'POST', body: '{"a":1}' }))).toBe('{"a":1}');
  });
});

describe('rate limits (token buckets)', () => {
  it('allows a burst, refuses beyond it with a retry-after, and refills over time', () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    const spec = { capacity: 3, refillSeconds: 10 };
    expect([rl.take('k', spec), rl.take('k', spec), rl.take('k', spec)]).toEqual([0, 0, 0]);
    expect(rl.take('k', spec)).toBe(10);
    t += 10_000;
    expect(rl.take('k', spec)).toBe(0);
    expect(rl.take('other', spec)).toBe(0); // per key
  });
  it('takeAll spends only when every bucket has a token', () => {
    const rl = new RateLimiter(() => 0);
    const one = { capacity: 1, refillSeconds: 60 };
    expect(rl.takeAll([['a', one], ['b', one]])).toBe(0);
    expect(rl.takeAll([['a', one], ['c', one]])).toBe(60);
    expect(rl.takeAll([['c', one]])).toBe(0); // c was not spent by the refused call
  });
  it('limits live-AI intake per IP and per visitor, and reads the client IP Render saw', () => {
    limiter().reset();
    const req = (ip: string) => new Request('http://x/api/intake/a/text', { method: 'POST', headers: { 'x-forwarded-for': `1.2.3.4, ${ip}` } });
    expect(clientIp(req('9.9.9.9'), {})).toBe('9.9.9.9');
    let refused = 0;
    for (let i = 0; i < 20; i++) {
      try {
        enforceLimit(req('5.5.5.5'), 'ai', { visitorTag: 'aaaaaaaaaaaa', env: {} });
      } catch (err) {
        refused++;
        expect(err).toMatchObject({ status: 429, headers: { 'retry-after': expect.any(String) } });
      }
    }
    expect(refused).toBe(20 - 8); // visitor bucket: 8
    expect(() => enforceLimit(req('5.5.5.5'), 'ai', { visitorTag: 'bbbbbbbbbbbb', env: {} })).not.toThrow(); // other visitor, same IP: IP bucket (12) still has tokens
    expect(() => enforceLimit(req('5.5.5.5'), 'ai', { env: { RATE_LIMITS: 'off' } })).not.toThrow();
    limiter().reset();
  });
});

describe('visitor sessions (visitor.ts)', () => {
  const env = { NEIGHBORLINE_SESSION_SECRET: 's'.repeat(40) };
  it('signs the cookie and derives a stable tag; a forged cookie is ignored', () => {
    const v = decodeVisitor(encodeVisitor('abcdefghijklmnopqrstuv', env), env)!;
    expect(v.tag).toBe(visitorTag('abcdefghijklmnopqrstuv'));
    expect(v.tag).toMatch(/^[0-9a-f]{12}$/);
    expect(decodeVisitor('abcdefghijklmnopqrstuv.forged', env)).toBeNull();
    expect(decodeVisitor(encodeVisitor('abcdefghijklmnopqrstuv', { NEIGHBORLINE_SESSION_SECRET: 't'.repeat(40) }), env)).toBeNull();
  });
  it('request ids carry the owner tag (demo runs and /call), seeded ids carry none', () => {
    expect(ownerTagOf(demoRunId('0123456789ab'))).toBe('0123456789ab');
    expect(ownerTagOf(visitorRequestId('0123456789ab'))).toBe('0123456789ab');
    expect(ownerTagOf('req_seed_q_ana')).toBeNull();
    expect(ownerTagOf('req_demo_abc123')).toBeNull();
    expect(() => demoRunId('nope')).toThrow();
  });
});

const viewer = (o: Partial<Viewer> = {}): Viewer => ({ organizer: null, visitor: null, demo: true, ...o });
const me = { id: 'x', tag: '0123456789ab', fresh: false };

describe('who sees what (viewer.ts)', () => {
  it('organizers see everything; a visitor sees own runs in full, seed redacted, other visitors hidden (demo)', () => {
    const own = demoRunId(me.tag);
    const theirs = demoRunId('ffffffffffff');
    const anon = viewer({ visitor: me });
    expect(accessTo(anon, own)).toBe('full');
    expect(accessTo(anon, theirs)).toBe('hidden');
    expect(accessTo(anon, 'req_seed_q_ana')).toBe('redacted');
    expect(accessTo(viewer(), own)).toBe('hidden');
    expect(accessTo({ ...anon, demo: false }, theirs)).toBe('redacted');
    const org = viewer({ organizer: { organizerId: 'org_dana', name: 'Dana', credentialId: 'c', deviceLabel: 'p', kind: 'passkey' } });
    expect(accessTo(org, theirs)).toBe('full');
    expect(ownsAll(anon, [own])).toBe(true);
    expect(ownsAll(anon, [own, 'req_seed_q_ana'])).toBe(false);
  });
});

describe('redacted views (redact.ts)', () => {
  it('masks contacts and street addresses in free text', () => {
    const t = redactText('Call me at 503-555-0199, Venmo @jane-private9, I live at 1100 Oak St apt 3B or jane@example.com');
    expect(t).not.toMatch(/503-555-0199|@jane-private9|Oak St|jane@example\.com/);
    expect(t).toContain('[address]');
  });
});

let h: Harness;
describe('engine end to end', () => {
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('a visitor’s /call request is full for them and redacted for everyone else', async () => {
    const id = visitorRequestId(me.tag);
    await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_text', id });
    await h.engine.submitText(id, { text: 'My power is out, I need a heater. Call me at 503-555-0199, I live at 1100 Oak St. Venmo @jane-private9', lang: 'en' });
    const views = await h.engine.listRequests();
    const mine = viewsFor(viewer({ visitor: me }), views).find((v) => v.request.id === id);
    expect(mine?.redacted).toBeUndefined();
    expect(mine?.request.originalText).toContain('503-555-0199');
    // another visitor, in demo: hidden; outside demo: redacted
    const other = { id: 'y', tag: 'ffffffffffff', fresh: false };
    expect(viewsFor(viewer({ visitor: other }), views).some((v) => v.request.id === id)).toBe(false);
    const red = viewsFor(viewer({ visitor: other, demo: false }), views).find((v) => v.request.id === id)!;
    const json = JSON.stringify(red);
    expect(red.redacted).toBe(true);
    expect(json).not.toMatch(/503-555-0199|Oak St|jane-private9/);
    expect(red.request.originalText).toBe('');
  });

  it('the seeded queue is redacted for anonymous readers: first name + area, masked destination, no transcript', async () => {
    const ana = (await h.engine.getRequest('req_seed_q_ana'))!;
    const r = redactRequestView(ana);
    expect(r.request.originalText).toBe('');
    expect(r.request.englishText).toBe('');
    expect(r.request.payoutDestination?.value).not.toBe(ana.request.payoutDestination?.value);
    expect(r.request.payoutDestination?.value).toContain('•');
    expect(r.requester.displayName.split(' ')).toHaveLength(1);
    expect(r.request.computed).toEqual(ana.request.computed); // the amount and its rule stay visible
  });

  it('stream: other visitors’ events are dropped, redacted requests lose their text, own runs are full', async () => {
    const run = await h.engine.playScenario({ scenario: 'lan', mode: 'auto', speed: 20, visitorTag: me.tag });
    await waitFor(() => h.engine.replay(run.requestId).some((m) => m.kind === 'stage' && m.event.type === 'request.transcribed'), 10_000, 'transcribed');
    const msgs = h.engine.replay(run.requestId) as StreamMessage[];
    const transcribed = msgs.find((m) => m.kind === 'stage' && m.event.type === 'request.transcribed')!;
    expect(streamMessageFor(viewer({ visitor: me }), transcribed)).toEqual(transcribed);
    expect(streamMessageFor(viewer({ visitor: { id: 'y', tag: 'ffffffffffff', fresh: false } }), transcribed)).toBeNull();
    const red = streamMessageFor(viewer({ visitor: { id: 'y', tag: 'ffffffffffff', fresh: false }, demo: false }), transcribed) as Extract<StreamMessage, { kind: 'stage' }>;
    expect((red.event as { text: string }).text).toBe('');
    expect(streamMessageFor(viewer(), { kind: 'reset', at: 'now' })).toEqual({ kind: 'reset', at: 'now' });
  });

  it('concurrent approval taps all return 200 with one batch (QA P2-1)', async () => {
    const run = await h.engine.playScenario({ scenario: 'jean', mode: 'manual', speed: 20, visitorTag: me.tag });
    await waitFor(async () => (await h.engine.getRequest(run.requestId))?.approvals.length === 1, 15_000, 'Dana');
    const taps = await Promise.allSettled(Array.from({ length: 6 }, () => h.engine.approve({ requestIds: [run.requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } })));
    expect(taps.filter((t) => t.status === 'rejected')).toEqual([]);
    const ids = new Set(taps.map((t) => (t as PromiseFulfilledResult<{ batchId?: string }>).value.batchId));
    expect(ids.size).toBe(1);
  });

  it('a reset is broadcast to open streams so a stage can offer a replay', async () => {
    const got: StreamMessage[] = [];
    const off = h.engine.subscribe((m) => got.push(m));
    await h.engine.resetDemo();
    off();
    expect(got.some((m) => m.kind === 'reset')).toBe(true);
  });
});

export type { RequestView };
