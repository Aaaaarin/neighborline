/**
 * The human check for live-AI intake (THREAT_MODEL T37): mode selection, proof of work (bound to the
 * visitor, expiring, single use across instances), Turnstile siteverify, the pass cookie, and the CSP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb, migrate, type DbHandle } from '@neighborline/db';
import { humanCheckMode } from '../lib/human-check-mode';
import { meetsBits, prefixHasher, powPrefix, solvePow } from '../lib/pow';
import { contentSecurityPolicy } from '../lib/security-headers';
import {
  CHALLENGE_TTL_MS,
  HUMAN_COOKIE,
  PASS_TTL_MS,
  POW_COUNT,
  SITEVERIFY_URL,
  humanCheck,
  passExpiry,
  passValue,
  powCheck,
  requireHuman,
  turnstileCheck,
  type HumanChallenge,
} from '../lib/server/security/human-check';
import { RateLimiter, SharedRateLimiter } from '../lib/server/security/rate-limit';
import type { Viewer } from '../lib/server/security/viewer';
import { visitorTag, type Visitor } from '../lib/server/security/visitor';

const env = { NEIGHBORLINE_SESSION_SECRET: 'h'.repeat(40), HUMAN_CHECK_POW_BITS: '8' };
const visitor = (id: string): Visitor => ({ id, tag: visitorTag(id), fresh: false });
const alice = visitor('alice-visitor-id-0001');
const bob = visitor('bob-visitor-id-0000002');
const ip = { ip: '203.0.113.9' };

describe('which check runs (lib/human-check-mode.ts)', () => {
  it('none in fixture mode, proof of work in live mode, Turnstile when both keys are set', () => {
    expect(humanCheckMode({}, 'fixture')).toBe('off');
    expect(humanCheckMode({ TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k' }, 'fixture')).toBe('off');
    expect(humanCheckMode({}, 'live')).toBe('pow');
    expect(humanCheckMode({ TURNSTILE_SECRET: 's' }, 'live')).toBe('pow'); // half-configured: never a broken widget
    expect(humanCheckMode({ TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k' }, 'live')).toBe('turnstile');
    expect(humanCheckMode({ HUMAN_CHECK: 'off' }, 'live')).toBe('off');
    expect(humanCheckMode({ HUMAN_CHECK: 'pow' }, 'fixture')).toBe('pow');
    expect(humanCheckMode({ AI_MODE: 'live' })).toBe('pow');
    expect(humanCheck('fixture', { env: {} }).challenge(alice)).toEqual({ kind: 'none' });
  });

  it('the CSP names challenges.cloudflare.com only when Turnstile is on', () => {
    expect(contentSecurityPolicy('n', { dev: false })).not.toContain('challenges.cloudflare.com');
    const on = contentSecurityPolicy('n', { dev: false, turnstile: true });
    expect(on).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(on).toMatch(/frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(on).not.toMatch(/connect-src [^;]*cloudflare/);
  });
});

describe('proof of work (lib/pow.ts)', () => {
  it('the browser hasher agrees with node:crypto across block boundaries', () => {
    for (const pre of ['', 'abc.', 'x'.repeat(55), 'x'.repeat(63), 'x'.repeat(64), 'y'.repeat(130)]) {
      for (const n of [0, 9, 123456, 4294967295]) {
        expect(prefixHasher(pre)(n)).toBe(createHash('sha256').update(`${pre}${n}`).digest().readUInt32BE(0));
      }
    }
    expect(meetsBits(0x0000ffff, 16)).toBe(true);
    expect(meetsBits(0x00010000, 16)).toBe(false);
    expect(meetsBits(0, 32)).toBe(true);
  });
});

describe('proof-of-work check', () => {
  let t = Date.parse('2026-10-17T12:00:00Z');
  const now = () => t;
  const solve = async (ch: HumanChallenge) => {
    if (ch.kind !== 'pow') throw new Error(`expected pow, got ${ch.kind}`);
    return { kind: 'pow' as const, challenge: ch.challenge, solution: await solvePow(ch) };
  };

  it('issues a signed challenge bound to the visitor; a correct solution passes once', async () => {
    const check = powCheck({ env, now, limiter: new RateLimiter(now) });
    const ch = check.challenge(alice);
    expect(ch).toMatchObject({ kind: 'pow', bits: 8, count: POW_COUNT });
    if (ch.kind === 'pow') expect(ch.challenge.split('.')[1]).toBe(alice.tag);
    const proof = await solve(ch);
    await expect(check.verify(alice, proof, ip)).resolves.toBeUndefined();
    await expect(check.verify(alice, proof, ip)).rejects.toMatchObject({ status: 409 }); // replay
  });

  it('refuses another visitor, an expired challenge, a forged one, a wrong answer and an easier one', async () => {
    const check = powCheck({ env, now, limiter: new RateLimiter(now) });
    const proof = await solve(check.challenge(alice));
    await expect(check.verify(bob, proof, ip)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/another browser/) });

    const late = await solve(check.challenge(alice));
    t += CHALLENGE_TTL_MS + 1;
    await expect(check.verify(alice, late, ip)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/expired/) });

    const fresh = await solve(check.challenge(alice));
    const parts = fresh.challenge.split('.');
    parts[4] = '1'; // claim 1-bit puzzles, keep the old MAC
    await expect(check.verify(alice, { ...fresh, challenge: parts.join('.') }, ip)).rejects.toMatchObject({ status: 400, message: /Unknown challenge/ });
    const wrong = fresh.solution.map((n, i) => {
      // find an n that does NOT meet the target for puzzle i
      const h = prefixHasher(powPrefix(fresh.challenge, i));
      let m = n + 1;
      while (meetsBits(h(m), 8)) m++;
      return m;
    });
    await expect(check.verify(alice, { ...fresh, solution: wrong }, ip)).rejects.toMatchObject({ status: 400, message: /Wrong/ });
    await expect(check.verify(alice, { ...fresh, solution: fresh.solution.slice(1) }, ip)).rejects.toMatchObject({ status: 400 });

    // The operator raised the difficulty: challenges issued before are refused.
    const harder = powCheck({ env: { ...env, HUMAN_CHECK_POW_BITS: '10' }, now, limiter: new RateLimiter(now) });
    await expect(harder.verify(alice, fresh, ip)).rejects.toMatchObject({ status: 400, message: /out of date/ });
    await expect(check.verify(alice, fresh, ip)).resolves.toBeUndefined();
  });

  describe('replay across two web instances (shared store)', () => {
    let h: DbHandle;
    beforeAll(async () => {
      h = createDb({ memory: true });
      await migrate(h.db);
    });
    afterAll(async () => h.close());

    it('a solution accepted by one instance is refused by the other, even in parallel', async () => {
      const shared = () => {
        const l = new SharedRateLimiter(now, () => Buffer.alloc(32, 5));
        l.attach(h.db);
        return l;
      };
      const [a, b] = [powCheck({ env, now, limiter: shared() }), powCheck({ env, now, limiter: shared() })];
      const proof = await solve(a.challenge(alice));
      const results = await Promise.allSettled([a.verify(alice, proof, ip), b.verify(alice, proof, ip), a.verify(alice, proof, ip), b.verify(alice, proof, ip)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
});

describe('Turnstile check', () => {
  const tsEnv = { ...env, TURNSTILE_SECRET: 'secret-xyz', TURNSTILE_SITE_KEY: 'site-abc' };
  const fakeFetch = (reply: unknown, seen: unknown[] = []) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      if (reply instanceof Error) throw reply;
      return Response.json(reply);
    }) as unknown as typeof fetch;

  it('asks for our action and the visitor tag as cData, and verifies with siteverify', async () => {
    const seen: Array<{ url: string; body: Record<string, string> }> = [];
    const check = turnstileCheck({ env: tsEnv, fetch: fakeFetch({ success: true, action: 'intake', cdata: alice.tag, hostname: 'x' }, seen) });
    expect(check.challenge(alice)).toEqual({ kind: 'turnstile', siteKey: 'site-abc', action: 'intake', cData: alice.tag });
    await expect(check.verify(alice, { kind: 'turnstile', token: 'tok' }, ip)).resolves.toBeUndefined();
    expect(seen[0]!.url).toBe(SITEVERIFY_URL);
    expect(seen[0]!.body).toMatchObject({ secret: 'secret-xyz', response: 'tok', remoteip: '203.0.113.9', idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it('fails closed: refused, for another visitor or action, unreachable, oversized', async () => {
    const v = (reply: unknown) => turnstileCheck({ env: tsEnv, fetch: fakeFetch(reply) }).verify(alice, { kind: 'turnstile', token: 'tok' }, ip);
    await expect(v({ success: false, 'error-codes': ['timeout-or-duplicate'] })).rejects.toMatchObject({ status: 400 });
    await expect(v({ success: true, action: 'intake', cdata: bob.tag })).rejects.toMatchObject({ status: 400 });
    await expect(v({ success: true, action: 'login', cdata: alice.tag })).rejects.toMatchObject({ status: 400 });
    await expect(v(new Error('ECONNRESET'))).rejects.toMatchObject({ status: 503 });
    await expect(turnstileCheck({ env: tsEnv, fetch: fakeFetch({ success: true }) }).verify(alice, { kind: 'turnstile', token: 'x'.repeat(2049) }, ip)).rejects.toMatchObject({ status: 400 });
    await expect(turnstileCheck({ env: tsEnv }).verify(alice, { kind: 'pow', challenge: 'c', solution: [1] }, ip)).rejects.toMatchObject({ status: 400 });
  });
});

describe('the human pass', () => {
  const T = Date.parse('2026-10-17T12:00:00Z');
  const withCookie = (value: string) => new Request('http://x/api/intake/a/text', { method: 'POST', headers: { cookie: `nl_visitor=whatever; ${HUMAN_COOKIE}=${value}` } });
  const viewer = (v: Visitor | null, organizer = false): Viewer => ({ visitor: v, organizer: organizer ? ({ organizerId: 'org_dana' } as Viewer['organizer']) : null, demo: true });

  it('is bound to the visitor, signed and expires after 30 minutes', () => {
    const value = passValue(alice, 'pow', { env, now: T });
    expect(passExpiry(withCookie(value), alice, { env, now: T })).toBe(T + PASS_TTL_MS);
    expect(passExpiry(withCookie(value), bob, { env, now: T })).toBeNull();
    expect(passExpiry(withCookie(value), alice, { env, now: T + PASS_TTL_MS + 1 })).toBeNull();
    expect(passExpiry(withCookie(value.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), alice, { env, now: T })).toBeNull();
    expect(passExpiry(withCookie(value), alice, { env: { NEIGHBORLINE_SESSION_SECRET: 'z'.repeat(40) }, now: T })).toBeNull();
    expect(passExpiry(withCookie(value), null, { env, now: T })).toBeNull();
  });

  it('requireHuman: off never asks, organizers are exempt, everyone else needs a pass', () => {
    const value = passValue(alice, 'pow', { env, now: T });
    const bare = new Request('http://x/', { method: 'POST' });
    expect(() => requireHuman(bare, viewer(alice), { mode: 'off' }, { env, now: T })).not.toThrow();
    expect(() => requireHuman(bare, viewer(null, true), { mode: 'pow' }, { env, now: T })).not.toThrow();
    expect(() => requireHuman(withCookie(value), viewer(alice), { mode: 'pow' }, { env, now: T })).not.toThrow();
    let err: unknown;
    try {
      requireHuman(bare, viewer(alice), { mode: 'turnstile' }, { env, now: T });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 403, code: 'human_check_required' });
    expect(() => requireHuman(withCookie(value), viewer(bob), { mode: 'pow' }, { env, now: T })).toThrow();
  });
});
