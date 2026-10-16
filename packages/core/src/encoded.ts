/**
 * Short encoded payloads: a base64 string too short to look like a "blob" is only suspicious when
 * it decodes to readable text that reads like an instruction. Pure (no I/O); used by injection.ts.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 → bytes, or null when the token is not valid base64. */
export function decodeBase64(token: string): Uint8Array | null {
  const s = token.replace(/=+$/, '');
  if (s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) return null;
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Decoded UTF-8 text when the token is base64 of readable text (≥ 90% printable), else null. */
export function decodeReadableBase64(token: string): string | null {
  const bytes = decodeBase64(token);
  if (!bytes || bytes.length < 8) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const printable = Array.from(text).filter((c) => /[\p{L}\p{N}\p{P}\p{Zs}$+=<>|~^`]/u.test(c)).length;
  return printable / Array.from(text).length >= 0.9 && /\p{L}{3,}/u.test(text) ? text : null;
}

/** Candidate tokens: base64 alphabet, 16–59 chars, not a plain word (needs a digit, "+", "/" or mixed case). */
export function shortBase64Tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9+/=@._-])[A-Za-z0-9+/]{16,59}={0,2}(?![A-Za-z0-9+/=@._-])/g)) {
    const t = m[0];
    if (/[0-9+/]/.test(t) || (/[a-z]/.test(t) && /[A-Z]/.test(t.slice(1)))) out.push(t);
  }
  return out;
}
