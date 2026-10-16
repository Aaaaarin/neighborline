/**
 * ID generators that look like PayPal's (length + alphabet), so UIs, logs and validators behave the same
 * against the fake as against the sandbox. Deterministic when a seeded RNG is supplied.
 */
import { randomUUID } from 'node:crypto';

const UPPER_ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DIGITS = '0123456789';
const HEX = '0123456789abcdef';

export type Rng = () => number;

export interface IdFactory {
  /** Payout batch id, 13 chars, e.g. `Y4JB5BNLE8Z88`. */
  payoutBatch(): string;
  /** Payout item id, 13 chars, e.g. `8AELMXH8UB2P8`. */
  payoutItem(): string;
  /** Transaction / capture / order id, 17 chars, e.g. `0C413693MN970190K`. */
  transaction(): string;
  order(): string;
  capture(): string;
  /** `PROD-` + 17 chars. */
  product(): string;
  /** `P-` + 24 chars. */
  plan(): string;
  /** `I-` + 12 chars. */
  subscription(): string;
  /** `WH-` + 17 + `-` + 17, like webhook event ids. */
  webhookEvent(): string;
  /** 13 lowercase hex chars, like `debug_id`. */
  debugId(): string;
  accessToken(): string;
  transmissionId(): string;
}

function pick(rng: Rng, alphabet: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(rng() * alphabet.length)] ?? alphabet[0];
  return out;
}

/** PayPal transaction ids are mostly digits with a few letters: 8 digits + 2 letters + 6 digits + 1 letter. */
function txnLike(rng: Rng): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXY';
  return pick(rng, DIGITS, 1) + pick(rng, UPPER_ALNUM, 7) + pick(rng, letters, 2) + pick(rng, DIGITS, 6) + pick(rng, letters, 1);
}

/** Mulberry32: tiny seeded PRNG so tests can pin ids. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createIdFactory(rng: Rng = Math.random): IdFactory {
  return {
    payoutBatch: () => pick(rng, UPPER_ALNUM, 13),
    payoutItem: () => pick(rng, UPPER_ALNUM, 13),
    transaction: () => txnLike(rng),
    order: () => txnLike(rng),
    capture: () => txnLike(rng),
    product: () => `PROD-${pick(rng, UPPER_ALNUM, 17)}`,
    plan: () => `P-${pick(rng, UPPER_ALNUM, 24)}`,
    subscription: () => `I-${pick(rng, UPPER_ALNUM, 12)}`,
    webhookEvent: () => `WH-${pick(rng, UPPER_ALNUM, 17)}-${pick(rng, UPPER_ALNUM, 17)}`,
    debugId: () => pick(rng, HEX, 13),
    accessToken: () => `A21AA${pick(rng, UPPER_ALNUM + 'abcdefghijklmnopqrstuvwxyz-_', 92)}`,
    transmissionId: () => randomUUID(),
  };
}
