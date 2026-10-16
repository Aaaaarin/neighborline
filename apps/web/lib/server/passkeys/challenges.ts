/**
 * Short-lived, single-use WebAuthn challenges: registration, sign-in, and approval taps. An approval
 * challenge is challengeFor(approvalHash, serverNonce) (@neighborline/passkeys); the nonce is kept here
 * until the tap arrives, then stored next to the assertion so the approver can re-verify it.
 */
import { randomBytes } from 'node:crypto';

export interface PendingChallenge {
  purpose: 'register' | 'signin' | 'approve';
  organizerId?: string;
  /** register: 'demo-visitor:<tag>' when a /demo visitor enrolls their own device as Marcus. */
  boundTo?: string;
  /** approve: the approval hash and server nonce this challenge commits to. */
  approvalHash?: string;
  serverNonce?: string;
  origin: string;
  rpId: string;
  exp: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineChallenges: Map<string, PendingChallenge> | undefined;
}

const store = () => (globalThis.__neighborlineChallenges ??= new Map());
const TTL_MS = 5 * 60 * 1000;

export function newChallenge(p: Omit<PendingChallenge, 'exp'>, preset?: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = preset ? Buffer.from(preset) : randomBytes(32);
  const m = store();
  const now = Date.now();
  for (const [k, v] of m) if (v.exp < now) m.delete(k);
  m.set(bytes.toString('base64url'), { ...p, exp: now + TTL_MS });
  return Uint8Array.from(bytes);
}

/** One use only. */
export function takeChallenge(challenge: string, purpose: PendingChallenge['purpose']): PendingChallenge | null {
  const m = store();
  const v = m.get(challenge);
  m.delete(challenge);
  if (!v || v.purpose !== purpose || v.exp < Date.now()) return null;
  return v;
}
