/**
 * Handle normalization, confusable folding ("skeletons") and Damerau–Levenshtein distance.
 * Used to stop impersonation of the group's official PayPal/Venmo identities.
 */

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Lowercase, NFKC, drop zero-width/bidi chars, a leading "@", and separators (@ . _ - whitespace). */
export function normalizeHandle(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .replace(/[@._\-\s]+/g, '');
}

/** Single code point → Latin lookalike. Applied after lowercasing. */
export const CONFUSABLES: Readonly<Record<string, string>> = {
  // digits and symbols
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '|': 'l', '!': 'l',
  // Latin letters that render like others in many fonts
  i: 'l', 'ı': 'l', 'ł': 'l',
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'і': 'l', 'ї': 'l', 'ј': 'j', 'к': 'k', 'м': 'm', 'н': 'h',
  'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'ԁ': 'd', 'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'l', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
};

/** Multi-character lookalikes, applied after single-character folding (so "c1" → "cl" → "d"). */
export const MULTI_CONFUSABLES: ReadonlyArray<readonly [string, string]> = [
  ['rn', 'm'],
  ['vv', 'w'],
  ['cl', 'd'],
];

/**
 * Confusable skeleton: normalizeHandle + strip diacritics + fold lookalikes.
 * Two handles with the same skeleton are visually indistinguishable to a tired organizer at 2am.
 */
export function skeleton(raw: string): string {
  let s = normalizeHandle(raw).normalize('NFKD').replace(/\p{M}/gu, '');
  s = Array.from(s, (ch) => CONFUSABLES[ch] ?? ch).join('');
  for (const [from, to] of MULTI_CONFUSABLES) s = s.split(from).join(to);
  return s;
}

/**
 * Damerau–Levenshtein distance (optimal-string-alignment variant: insert, delete, substitute,
 * transpose adjacent). Operates on code points. `max` enables an early exit (returns max+1).
 */
export function damerauLevenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  const s = Array.from(a);
  const t = Array.from(b);
  if (Math.abs(s.length - t.length) > max) return max + 1;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  const cols = t.length + 1;
  let prev2 = new Array<number>(cols).fill(0);
  let prev = Array.from({ length: cols }, (_, j) => j);
  let cur = new Array<number>(cols).fill(0);
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        v = Math.min(v, (prev2[j - 2] as number) + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[t.length] as number;
}

/** Allowed skeleton distance for a lookalike, scaled by length to avoid flagging short handles. */
export function lookalikeThreshold(len: number): number {
  if (len >= 8) return 2;
  if (len >= 5) return 1;
  return 0;
}

const EMAIL = /^[^@\s]+@([^@\s]+)$/;

/** Shared mail providers: their domain says nothing about identity, so never compare it. */
export const FREE_MAIL: ReadonlySet<string> = new Set([
  'gmail', 'googlemail', 'yahoo', 'ymail', 'outlook', 'hotmail', 'live', 'msn', 'icloud', 'me', 'mac',
  'aol', 'proton', 'protonmail', 'pm', 'gmx', 'mail', 'zoho', 'yandex', 'qq', '163', '126', 'comcast',
  'att', 'verizon', 'sbcglobal', 'bellsouth', 'cox', 'charter', 'earthlink', 'fastmail',
]);

/**
 * Comparable forms of a handle: the full skeleton, plus for emails the local part and the
 * domain name without TLD (so "eastside-mutualaid@gmail.com" is compared to "@eastside-mutualaid").
 */
export function handleVariants(raw: string, opts: { includeLocalPart: boolean }): string[] {
  const out = new Set<string>([skeleton(raw)]);
  const m = EMAIL.exec(raw.trim());
  if (m) {
    const [local = ''] = raw.trim().split('@');
    const labels = (m[1] ?? '').toLowerCase().split('.');
    const name = labels.slice(0, -1).join('.');
    if (labels.length >= 2 && !FREE_MAIL.has(labels[0] ?? '')) out.add(skeleton(name));
    if (opts.includeLocalPart) out.add(skeleton(local));
  }
  out.delete('');
  return [...out];
}

export function isPhoneLike(raw: string): boolean {
  return !/[a-z]/i.test(raw) && raw.replace(/\D/g, '').length >= 7;
}
