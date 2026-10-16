/**
 * PII redaction for logs and AI traces (SPEC §2.6). Pure string functions, no I/O.
 *
 * Masks everything except the last 2 characters of:
 *   - email addresses        rosa.m.delgado@example.com → ••••••••••••••••••••••om
 *   - phone numbers (7+ digits, with spaces/dashes/dots/parens/+)  +1 (503) 555-0142 → ••••••••••••••42
 *   - @handles (Venmo, social)  @lan-nguyen54 → •••••••••••54
 * The mask keeps the original length, so log columns still line up and nothing reveals the domain.
 */

const MASK = '•';

export function maskKeepLast(value: string, keep = 2): string {
  const chars = [...value];
  if (chars.length <= keep) return MASK.repeat(chars.length);
  return MASK.repeat(chars.length - keep) + chars.slice(-keep).join('');
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// A run of digits with common separators, at least 7 digits in total.
const PHONE = /(?<![\p{L}\p{N}_])\+?\(?\d[\d\s().-]{5,}\d(?![\p{L}\p{N}_])/gu;
// @handle not preceded by a word character (so emails, already masked, are not re-matched).
const HANDLE = /(?<![\p{L}\p{N}_.@•])@[\p{L}\p{N}][\p{L}\p{N}_.-]{1,}/gu;

const digits = (s: string): number => (s.match(/\d/g) ?? []).length;

/** Redact emails, phone numbers and @handles inside free text. */
export function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, (m) => maskKeepLast(m))
    .replace(PHONE, (m) => {
      const d = digits(m);
      // Leave ISO timestamps, amounts and ids alone: 7–15 digits, and no ISO date shape.
      if (d < 7 || d > 15 || /^\d{4}-\d{2}-\d{2}/.test(m)) return m;
      const lead = m.match(/^\s*/)?.[0] ?? '';
      return lead + maskKeepLast(m.slice(lead.length));
    })
    .replace(HANDLE, (m) => maskKeepLast(m));
}

/** Deep-redact strings in a JSON-like value (objects, arrays). Keys are kept; values are masked. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return redactPII(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, depth + 1);
    return out as T;
  }
  return value;
}
