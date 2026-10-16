/**
 * Which origins and RP ID a passkey signature must be bound to. Shared by the web app (when it
 * asks for and checks a signature) and the approval service (when it re-verifies one), so both
 * read the same environment the same way:
 *
 *   WEBAUTHN_ORIGIN   comma-separated origins, e.g. https://neighborline.onrender.com
 *   WEBAUTHN_RP_ID    RP ID (a registrable domain of those origins); default = the origin's hostname
 *   APP_BASE_URL      fallback origin when WEBAUTHN_ORIGIN is unset, then RENDER_EXTERNAL_URL (Render sets it)
 *   DEMO_MODE / NODE_ENV  when DEMO_MODE is on (see demoModeOn) or NODE_ENV != 'production', http://localhost:*
 *                     and http://127.0.0.1:* are also accepted (local dev, e2e, screenshots)
 */
export type PasskeyEnv = Record<string, string | undefined>;

export const RP_NAME = 'Neighborline';

const originOf = (u: string | undefined): string | null => {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

export function configuredOrigins(env: PasskeyEnv): string[] {
  const list = (env.WEBAUTHN_ORIGIN ?? '')
    .split(',')
    .map((s) => originOf(s.trim()))
    .filter((s): s is string => !!s);
  if (list.length) return list;
  return [originOf(env.APP_BASE_URL) ?? originOf(env.RENDER_EXTERNAL_URL) ?? 'http://localhost:3000'];
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * DEMO_MODE fails closed and is read the same way by the web app and the approver:
 * an explicit DEMO_MODE=true|false wins; unset means ON only when PAYPAL_MODE=fake (nothing real can
 * move), OFF for sandbox/live. It is never on with PAYPAL_MODE=live.
 */
export function demoModeOn(env: PasskeyEnv): boolean {
  const mode = (env.PAYPAL_MODE ?? 'fake').trim().toLowerCase();
  if (mode === 'live') return false;
  const raw = (env.DEMO_MODE ?? '').trim().toLowerCase();
  if (raw) return /^(1|true|yes)$/.test(raw);
  return mode === 'fake';
}

export function localOriginsAllowed(env: PasskeyEnv): boolean {
  return demoModeOn(env) || env.NODE_ENV !== 'production';
}

export function isAllowedOrigin(origin: string, env: PasskeyEnv): boolean {
  if (configuredOrigins(env).includes(origin)) return true;
  return localOriginsAllowed(env) && LOCAL.test(origin);
}

export interface RelyingParty {
  rpName: string;
  rpId: string;
  origin: string;
}

/**
 * The RP for a ceremony. `requestOrigin` (the browser's Origin header) is used when it is allowed;
 * otherwise the first configured origin. Server-side signing (demo key, seeded history) passes none.
 */
export function relyingParty(env: PasskeyEnv, requestOrigin?: string | null): RelyingParty {
  const origin = requestOrigin && isAllowedOrigin(requestOrigin, env) ? requestOrigin : configuredOrigins(env)[0]!;
  return { rpName: RP_NAME, rpId: env.WEBAUTHN_RP_ID || new URL(origin).hostname, origin };
}

/** What to pass as expectedOrigin / expectedRpId when (re-)verifying a stored assertion. */
export function expectedFor(assertion: { origin: string }, env: PasskeyEnv): { expectedOrigin: string[]; expectedRpId: string } | null {
  if (!isAllowedOrigin(assertion.origin, env)) return null;
  return { expectedOrigin: [assertion.origin], expectedRpId: env.WEBAUTHN_RP_ID || new URL(assertion.origin).hostname };
}
