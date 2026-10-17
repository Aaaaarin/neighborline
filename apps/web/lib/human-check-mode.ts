/**
 * Which human check guards live-AI intake (THREAT_MODEL T37). Pure and dependency-free so the edge
 * middleware (CSP) and the server agree.
 *
 *   HUMAN_CHECK=auto (default)  AI_MODE=live: Turnstile when TURNSTILE_SECRET and TURNSTILE_SITE_KEY
 *                               are set, else proof of work. Fixture mode: none (nothing costs money).
 *   HUMAN_CHECK=off             none
 *   HUMAN_CHECK=pow             proof of work whatever the AI mode (e2e exercises the path this way)
 *   HUMAN_CHECK=turnstile       Turnstile (proof of work if its keys are missing)
 *
 * The scripted /demo never asks: it plays bundled samples, which cost no model call.
 */
export type HumanCheckMode = 'off' | 'pow' | 'turnstile';

type Env = Record<string, string | undefined>;

export const turnstileConfigured = (env: Env): boolean => !!(env.TURNSTILE_SECRET?.trim() && env.TURNSTILE_SITE_KEY?.trim());

export function humanCheckMode(env: Env, aiMode: 'live' | 'fixture' | string = (env.AI_MODE ?? 'fixture').trim().toLowerCase()): HumanCheckMode {
  const want = (env.HUMAN_CHECK ?? 'auto').trim().toLowerCase();
  if (want === 'off') return 'off';
  if (want === 'pow') return 'pow';
  if (want === 'turnstile') return turnstileConfigured(env) ? 'turnstile' : 'pow';
  if (aiMode !== 'live') return 'off';
  return turnstileConfigured(env) ? 'turnstile' : 'pow';
}

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
/** Turnstile `action` (≤ 32 chars, [A-Za-z0-9_-]); siteverify must echo it back. */
export const TURNSTILE_ACTION = 'intake';
