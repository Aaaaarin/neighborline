/**
 * Webhook signing for the fake. Real PayPal signs `transmission_id|transmission_time|webhook_id|crc32(raw body)`
 * with an RSA key (SHA256withRSA) whose cert is at PAYPAL-CERT-URL. The fake signs the same string with an
 * HMAC secret, so the *inputs* (and the "re-serializing the body breaks verification" property) are identical.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of UTF-8 bytes, as an unsigned decimal — the form PayPal uses in the signed string. */
export function crc32(text: string): number {
  const bytes = Buffer.from(text, 'utf8');
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function signedString(transmissionId: string, transmissionTime: string, webhookId: string, rawBody: string): string {
  return `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(rawBody)}`;
}

export function sign(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Structural JSON equality (key order insensitive) — what "the same webhook_event" means after a JSON round trip. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((v, i) => jsonEqual(v, bArr[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
}
