/** HMAC key for organizer session cookies. Random per process when unset (sessions end on restart). Invite codes are not derived from it: they are single use, stored hashed (db organizer_invites). */
import { createHmac, randomBytes } from 'node:crypto';

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineSessionSecret: Buffer | undefined;
}

export function sessionSecret(env: Record<string, string | undefined> = process.env): Buffer {
  const s = env.NEIGHBORLINE_SESSION_SECRET;
  if (s && s.length >= 32) return Buffer.from(s, 'utf8');
  globalThis.__neighborlineSessionSecret ??= randomBytes(32);
  return globalThis.__neighborlineSessionSecret;
}

export const hmac = (key: Buffer, msg: string): string => createHmac('sha256', key).update(msg).digest('base64url');
