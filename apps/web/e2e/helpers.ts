import { createHmac } from 'node:crypto';

/** The invite code an existing organizer would hand out (HMAC of the organizer id; see lib/server/passkeys/secret.ts). */
export function inviteCode(organizerId: string): string {
  const secret = process.env.NEIGHBORLINE_SESSION_SECRET;
  if (!secret) throw new Error('playwright.config sets NEIGHBORLINE_SESSION_SECRET for the web server');
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(`invite:${organizerId}`).digest('base64url').slice(0, 12);
}
