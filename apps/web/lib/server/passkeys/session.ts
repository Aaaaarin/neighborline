/**
 * Organizer session: an HMAC-signed, HttpOnly cookie minted only after a passkey sign-in (or a
 * passkey registration). It says who is looking at /organizer; it does NOT authorize payouts —
 * every Approve tap carries its own WebAuthn signature over the approval hash.
 */
import { timingSafeEqual } from 'node:crypto';
import type { OrganizerSession } from '../../types';
import { hmac, sessionSecret } from './secret';

export const SESSION_COOKIE = 'nl_organizer';
const TTL_MS = 12 * 60 * 60 * 1000;

export function encodeSession(s: OrganizerSession, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: now + TTL_MS }), 'utf8').toString('base64url');
  return `${payload}.${hmac(sessionSecret(), payload)}`;
}

export function decodeSession(raw: string | undefined | null, now = Date.now()): OrganizerSession | null {
  if (!raw) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const want = Buffer.from(hmac(sessionSecret(), payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OrganizerSession & { exp: number };
    if (typeof v.exp !== 'number' || v.exp < now) return null;
    return { organizerId: v.organizerId, name: v.name, credentialId: v.credentialId, deviceLabel: v.deviceLabel, kind: v.kind };
  } catch {
    return null;
  }
}

export function sessionCookieHeader(value: string | null, secure: boolean): string {
  const base = `${SESSION_COOKIE}=${value ?? ''}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return value ? `${base}; Max-Age=${TTL_MS / 1000}` : `${base}; Max-Age=0`;
}

export function readSessionFromRequest(req: Request): OrganizerSession | null {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return decodeSession(m?.slice(SESSION_COOKIE.length + 1));
}
