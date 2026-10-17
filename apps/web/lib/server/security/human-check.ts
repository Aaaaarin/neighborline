/**
 * Bot protection for live-AI intake on the hosted demo (THREAT_MODEL T37, R9).
 *
 * A pluggable `HumanCheck` turns one proof into a short-lived *human pass*: an HMAC-signed, HttpOnly
 * cookie bound to the visitor (lib/server/security/visitor.ts) that every model-using intake call
 * requires (`requireHuman`, called from limitIntake). Two implementations:
 *
 *   turnstile  Cloudflare Turnstile, verified server-side with siteverify (token single use and ≤ 5 min
 *              old by Cloudflare's rules; we also require our action and the visitor tag as cData).
 *   pow        Hashcash-style proof of work (lib/pow.ts): an HMAC-signed challenge bound to the visitor
 *              tag with a 2-minute expiry; each challenge's nonce is spent once in the shared
 *              rate-limit store, so a solution cannot be replayed, on this instance or another.
 *
 * Which one runs is lib/human-check-mode.ts (none in fixture mode; the scripted /demo never asks).
 * Signed-in organizers are passkey-authenticated and never asked. Nothing is visual: Turnstile's managed
 * widget is accessible, and proof of work runs in the background.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../errors';
import { errorText, log } from '../log';
import { hmac, sessionSecret } from '../passkeys/secret';
import { humanCheckMode, TURNSTILE_ACTION, type HumanCheckMode } from '../../human-check-mode';
import { meetsBits } from '../../pow';
import { limiter, type TokenLimiter } from './rate-limit';
import type { Viewer } from './viewer';
import type { Visitor } from './visitor';

type Env = Record<string, string | undefined>;

export const HUMAN_COOKIE = 'nl_human';
export const PASS_TTL_MS = 30 * 60_000;
export const CHALLENGE_TTL_MS = 2 * 60_000;
/** 32 puzzles of 14 bits: ~520k SHA-256 on average, ~200 ms in a laptop browser, low variance. */
export const POW_COUNT = 32;
export const POW_DEFAULT_BITS = 14;
const TAG_RE = /^[0-9a-f]{12}$/;

export type HumanChallenge =
  | { kind: 'none' }
  | { kind: 'passed'; expiresAt: string }
  | { kind: 'pow'; challenge: string; bits: number; count: number; expiresAt: string }
  | { kind: 'turnstile'; siteKey: string; action: string; cData: string };

export type HumanProof = { kind: 'pow'; challenge: string; solution: number[] } | { kind: 'turnstile'; token: string };

/** 403 with a machine-readable code: the browser runs the check and retries once. */
export class HumanCheckRequired extends HttpError {
  readonly code = 'human_check_required';
  constructor() {
    super(403, 'Please confirm you are a person first: reload the page and try again.');
  }
}

export interface HumanCheckDeps {
  env?: Env;
  now?: () => number;
  /** Spends single-use challenge nonces (shared store when the engine has a shared database). */
  limiter?: TokenLimiter;
  fetch?: typeof fetch;
}

export interface HumanCheck {
  readonly mode: HumanCheckMode;
  /** What the browser must do (or that it need not). */
  challenge(visitor: Visitor): HumanChallenge;
  /** Verify a proof for this visitor; throws HttpError on failure. Success means: issue a pass. */
  verify(visitor: Visitor, proof: HumanProof, ctx: { ip: string }): Promise<void>;
}

const powBits = (env: Env): number => {
  const n = Number(env.HUMAN_CHECK_POW_BITS);
  return Number.isInteger(n) && n >= 8 && n <= 22 ? n : POW_DEFAULT_BITS;
};

const macOf = (env: Env, domain: string, body: string) => hmac(sessionSecret(env), `neighborline/${domain}/v1\n${body}`);

function sameMac(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------------- proof of work ---------------- */

export function powCheck(deps: HumanCheckDeps = {}): HumanCheck {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  return {
    mode: 'pow',
    challenge(visitor) {
      const exp = now() + CHALLENGE_TTL_MS;
      const bits = powBits(env);
      const body = `pow1.${visitor.tag}.${exp.toString(36)}.${randomBytes(16).toString('base64url')}.${bits}.${POW_COUNT}`;
      return { kind: 'pow', challenge: `${body}.${macOf(env, 'pow', body)}`, bits, count: POW_COUNT, expiresAt: new Date(exp).toISOString() };
    },
    async verify(visitor, proof) {
      if (proof.kind !== 'pow') throw new HttpError(400, 'Expected a proof-of-work solution.');
      const parts = proof.challenge.split('.');
      if (parts.length !== 7 || parts[0] !== 'pow1') throw new HttpError(400, 'Malformed challenge.');
      const [, tag, exp36, nonce, bitsS, countS, mac] = parts as [string, string, string, string, string, string, string];
      if (!sameMac(mac, macOf(env, 'pow', parts.slice(0, 6).join('.')))) throw new HttpError(400, 'Unknown challenge.');
      if (!TAG_RE.test(tag) || tag !== visitor.tag) throw new HttpError(400, 'This challenge was issued to another browser.');
      if (parseInt(exp36, 36) < now()) throw new HttpError(400, 'The challenge expired. Try again.');
      const bits = Number(bitsS);
      const count = Number(countS);
      if (bits < powBits(env) || count < POW_COUNT) throw new HttpError(400, 'The challenge is out of date. Try again.');
      if (proof.solution.length !== count) throw new HttpError(400, 'Incomplete solution.');
      for (let i = 0; i < count; i++) {
        const n = proof.solution[i]!;
        const word = createHash('sha256').update(`${proof.challenge}.${i}.${n}`).digest().readUInt32BE(0);
        if (!meetsBits(word, bits)) throw new HttpError(400, 'Wrong solution.');
      }
      // Single use, across instances: a capacity-1 bucket that cannot refill before the challenge expires.
      const wait = await (deps.limiter ?? limiter()).takeAll([[`human:pow:${nonce}`, { capacity: 1, refillSeconds: 3600 }]]);
      if (wait) throw new HttpError(409, 'This challenge was already used. Try again.');
    },
  };
}

/* ---------------- Cloudflare Turnstile ---------------- */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileCheck(deps: HumanCheckDeps = {}): HumanCheck {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  return {
    mode: 'turnstile',
    challenge(visitor) {
      return { kind: 'turnstile', siteKey: env.TURNSTILE_SITE_KEY!.trim(), action: TURNSTILE_ACTION, cData: visitor.tag };
    },
    async verify(visitor, proof, ctx) {
      if (proof.kind !== 'turnstile') throw new HttpError(400, 'Expected a Turnstile token.');
      if (!proof.token || proof.token.length > 2048) throw new HttpError(400, 'Malformed Turnstile token.');
      let out: { success?: boolean; action?: string; cdata?: string; 'error-codes'?: string[] };
      try {
        const res = await doFetch(SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            secret: env.TURNSTILE_SECRET!.trim(),
            response: proof.token,
            ...(ctx.ip && ctx.ip !== 'local' ? { remoteip: ctx.ip } : {}),
            idempotency_key: randomUUID(),
          }),
          signal: AbortSignal.timeout(8_000),
        });
        out = (await res.json()) as typeof out;
      } catch (err) {
        log.warn('human.turnstile_unreachable', { error: errorText(err) });
        throw new HttpError(503, 'We could not check this browser just now. Try again in a moment.');
      }
      if (out.success !== true) {
        log.info('human.turnstile_refused', { codes: (out['error-codes'] ?? []).join(',') });
        throw new HttpError(400, 'The browser check did not pass. Try again.');
      }
      // Bind the token to what we asked for: our action, this visitor (a token solved for another
      // browser, or harvested from another page using our site key, does not carry this cData).
      if (out.action !== TURNSTILE_ACTION || out.cdata !== visitor.tag) throw new HttpError(400, 'The browser check was for something else. Try again.');
    },
  };
}

export const noCheck: HumanCheck = {
  mode: 'off',
  challenge: () => ({ kind: 'none' }),
  verify: async () => {},
};

/** The check for this server: mode from env + AI mode (lib/human-check-mode.ts). */
export function humanCheck(aiMode: string, deps: HumanCheckDeps = {}): HumanCheck {
  const mode = humanCheckMode(deps.env ?? process.env, aiMode);
  return mode === 'turnstile' ? turnstileCheck(deps) : mode === 'pow' ? powCheck(deps) : noCheck;
}

/* ---------------- the pass ---------------- */

export function passValue(visitor: Visitor, method: HumanCheckMode, opts: { env?: Env; now?: number } = {}): string {
  const body = `v1.${visitor.tag}.${((opts.now ?? Date.now()) + PASS_TTL_MS).toString(36)}.${method}`;
  return `${body}.${macOf(opts.env ?? process.env, 'human-pass', body)}`;
}

export function passCookieHeader(value: string, secure: boolean): string {
  return `${HUMAN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PASS_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

/** Expiry of this visitor's valid pass, or null. */
export function passExpiry(req: Request, visitor: Visitor | null | undefined, opts: { env?: Env; now?: number } = {}): number | null {
  if (!visitor) return null;
  const raw = (req.headers.get('cookie') ?? '')
    .split(/;\s*/)
    .find((c) => c.startsWith(`${HUMAN_COOKIE}=`))
    ?.slice(HUMAN_COOKIE.length + 1);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  if (!sameMac(parts[4]!, macOf(opts.env ?? process.env, 'human-pass', parts.slice(0, 4).join('.')))) return null;
  if (parts[1] !== visitor.tag) return null;
  const exp = parseInt(parts[2]!, 36);
  return exp > (opts.now ?? Date.now()) ? exp : null;
}

/**
 * Model-using intake calls need a pass when a check is on. Organizers (passkey sessions) are exempt.
 * Throws HumanCheckRequired (403, code human_check_required).
 */
export function requireHuman(req: Request, viewer: Viewer | null, check: Pick<HumanCheck, 'mode'>, opts: { env?: Env; now?: number } = {}): void {
  if (check.mode === 'off' || viewer?.organizer) return;
  if (passExpiry(req, viewer?.visitor, opts) === null) throw new HumanCheckRequired();
}
