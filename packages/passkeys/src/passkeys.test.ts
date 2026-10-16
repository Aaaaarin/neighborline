import { describe, expect, it } from 'vitest';
import { ApprovalAssertion, approvalHashFromChallenge, challengeForApprovalHash, createSoftwareAuthenticator, fromB64url, toB64url, verifyApprovalAssertion } from './index.js';

const HASH = 'a3'.repeat(32);
const OTHER = 'b4'.repeat(32);
const ORIGIN = 'https://neighborline.example';
const RP = 'neighborline.example';

function signed(hash = HASH) {
  const auth = createSoftwareAuthenticator();
  const parts = auth.sign({ challenge: challengeForApprovalHash(hash), origin: ORIGIN, rpId: RP });
  const credential = { id: auth.credentialId, publicKey: auth.publicKey, kind: 'demo_key' as const };
  return { auth, parts, credential };
}

describe('challenge encoding', () => {
  it('round-trips the approval hash through base64url', () => {
    const c = challengeForApprovalHash(HASH);
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(approvalHashFromChallenge(c)).toBe(HASH);
  });
  it('rejects anything that is not a 64-hex hash', () => {
    expect(() => challengeForApprovalHash('xyz')).toThrow();
    expect(() => challengeForApprovalHash(HASH.toUpperCase())).toThrow();
    expect(approvalHashFromChallenge(toB64url(new Uint8Array(16)))).toBeNull();
  });
});

describe('verifyApprovalAssertion', () => {
  it('accepts a demo-key assertion over the right hash', async () => {
    const { parts, credential } = signed();
    const r = await verifyApprovalAssertion({ assertion: parts, approvalHash: HASH, credential, expectedOrigin: ORIGIN, expectedRpId: RP });
    expect(r).toMatchObject({ ok: true, origin: ORIGIN, rpId: RP, userVerified: false });
  });

  it('rejects a signature over a different approval (approve one thing, pay another)', async () => {
    const { parts, credential } = signed();
    const r = await verifyApprovalAssertion({ assertion: parts, approvalHash: OTHER, credential, expectedOrigin: ORIGIN, expectedRpId: RP });
    expect(r.ok).toBe(false);
  });

  it('rejects another credential’s key, a wrong origin and a wrong RP id', async () => {
    const { parts, credential } = signed();
    const stranger = createSoftwareAuthenticator({ credentialId: credential.id });
    expect((await verifyApprovalAssertion({ assertion: parts, approvalHash: HASH, credential: { ...credential, publicKey: stranger.publicKey }, expectedOrigin: ORIGIN, expectedRpId: RP })).ok).toBe(false);
    expect((await verifyApprovalAssertion({ assertion: parts, approvalHash: HASH, credential, expectedOrigin: 'https://evil.example', expectedRpId: RP })).ok).toBe(false);
    expect((await verifyApprovalAssertion({ assertion: parts, approvalHash: HASH, credential, expectedOrigin: ORIGIN, expectedRpId: 'evil.example' })).ok).toBe(false);
  });

  it('rejects tampered authenticator data and a mismatched credential id', async () => {
    const { parts, credential } = signed();
    const ad = fromB64url(parts.authenticatorData);
    ad[33] = 0x09; // flip a counter byte
    expect((await verifyApprovalAssertion({ assertion: { ...parts, authenticatorData: toB64url(ad) }, approvalHash: HASH, credential, expectedOrigin: ORIGIN, expectedRpId: RP })).ok).toBe(false);
    expect((await verifyApprovalAssertion({ assertion: { ...parts, credentialId: 'AAAA' }, approvalHash: HASH, credential, expectedOrigin: ORIGIN, expectedRpId: RP })).ok).toBe(false);
  });

  it('never lets a demo key pass as a passkey (no user verification)', async () => {
    const { parts, credential } = signed();
    const r = await verifyApprovalAssertion({ assertion: parts, approvalHash: HASH, credential: { ...credential, kind: 'passkey' }, expectedOrigin: ORIGIN, expectedRpId: RP });
    expect(r.ok).toBe(false);
  });

  it('the stored record matches the ApprovalAssertion schema', () => {
    const { parts } = signed();
    const rec = { v: 1, kind: 'demo_key', ...parts, rpId: RP, origin: ORIGIN, approvalHash: HASH, deviceLabel: 'Dana’s phone (demo key)', verifiedAt: new Date().toISOString() };
    expect(ApprovalAssertion.parse(rec)).toEqual(rec);
  });
});

describe('relying party', async () => {
  const { configuredOrigins, expectedFor, isAllowedOrigin, relyingParty } = await import('./relying-party.js');
  it('reads WEBAUTHN_ORIGIN, then APP_BASE_URL, then localhost', () => {
    expect(configuredOrigins({ WEBAUTHN_ORIGIN: 'https://a.example, https://b.example/x' })).toEqual(['https://a.example', 'https://b.example']);
    expect(configuredOrigins({ APP_BASE_URL: 'https://nl.onrender.com/' })).toEqual(['https://nl.onrender.com']);
    expect(configuredOrigins({})).toEqual(['http://localhost:3000']);
  });
  it('allows local origins only outside production or in demo mode', () => {
    const prod = { NODE_ENV: 'production', DEMO_MODE: 'false', WEBAUTHN_ORIGIN: 'https://nl.example' };
    expect(isAllowedOrigin('http://localhost:3100', prod)).toBe(false);
    expect(isAllowedOrigin('https://nl.example', prod)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3100', { ...prod, DEMO_MODE: 'true' })).toBe(true);
    expect(isAllowedOrigin('https://evil.example', { DEMO_MODE: 'true' })).toBe(false);
  });
  it('derives the RP ID from the origin unless WEBAUTHN_RP_ID is set', () => {
    expect(relyingParty({}, 'http://127.0.0.1:3100')).toMatchObject({ rpId: '127.0.0.1', origin: 'http://127.0.0.1:3100' });
    expect(relyingParty({ WEBAUTHN_ORIGIN: 'https://app.nl.example', WEBAUTHN_RP_ID: 'nl.example' }, 'https://evil.example')).toMatchObject({ rpId: 'nl.example', origin: 'https://app.nl.example' });
    expect(expectedFor({ origin: 'https://evil.example' }, {})).toBeNull();
    expect(expectedFor({ origin: 'http://localhost:3000' }, {})).toEqual({ expectedOrigin: ['http://localhost:3000'], expectedRpId: 'localhost' });
  });
});
