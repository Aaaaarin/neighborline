/**
 * Payout handles and emails spoken aloud, in several languages:
 *   "my Venmo is at lan dash nguyen 54"                        → VENMO  @lan-nguyen54
 *   "Venmo của tôi là a còng lan gạch ngang nguyen 54"         → VENMO  @lan-nguyen54
 *   "mi correo de PayPal es rosa punto m punto delgado arroba example punto com"
 *                                                              → PAYPAL rosa.m.delgado@example.com
 *   "Venmo mwen se arobaz jean tire baptiste tire h"           → VENMO  @jean-baptiste-h
 * Deterministic: used to normalize what the model extracted AND to check it is grounded in what
 * the person actually said (the model must never invent a payout destination).
 */
import type { RecipientType, Wallet } from '@neighborline/core';

export interface DetectedPayout {
  wallet: Wallet;
  type: RecipientType;
  value: string;
}

/** Lowercase, strip diacritics (đ→d), unify apostrophes, collapse whitespace. */
export const fold = (s: string): string =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

// Order matters: multi-word phrases before their single-word prefixes.
const SYMBOL_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['guion bajo', '_'], ['gach duoi', '_'], ['tire anba', '_'], ['tiret bas', '_'], ['under score', '_'], ['underscore', '_'], ['soulinye', '_'],
  ['at sign', '@'], ['a cong', '@'], ['a moc', '@'], ['arroba', '@'], ['arobaz', '@'], ['arobase', '@'], ['at', '@'],
  ['gach ngang', '-'], ['gach noi', '-'], ['trait d\'union', '-'], ['dash', '-'], ['hyphen', '-'], ['guion', '-'], ['tiret', '-'], ['tire', '-'], ['hifen', '-'],
  ['dot', '.'], ['period', '.'], ['punto', '.'], ['cham', '.'], ['pwen', '.'], ['ponto', '.'], ['tuldok', '.'],
];
const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
};
const FILLERS = new Set([
  'venmo', 'paypal', 'phone', 'number', 'telefono', 'numero', 'so', 'dien', 'thoai', 'nimewo', 'telefon',
  // en
  'is', "it's", 'its', 'my', 'username', 'user', 'name', 'handle', 'account', 'email', 'e-mail', 'address', 'the', 'under', 'to', 'it', 'me', 'send', 'that', 'on',
  // es / pt
  'es', 'mi', 'de', 'del', 'usuario', 'correo', 'cuenta', 'el', 'se', 'llama', 'nombre', 'electronico', 'e', 'meu', 'minha',
  // vi
  'cua', 'toi', 'la', 'ten', 'tai', 'khoan', 'nguoi', 'dung',
  // ht / fr
  'mwen', 'non', 'kont', 'imel', "c'est", 'est', 'mon', 'ma', "d'utilisateur", 'utilisateur',
]);
const STOPS = new Set([
  'thank', 'thanks', 'please', 'and', 'gracias', 'por', 'favor', 'y', 'cam', 'xin', 'va', 'mesi', 'merci', 'epi', 'ak', 'et', 'obrigado', 'obrigada', 'salamat', 'but', 'pero',
]);

const WALLET_RE = /(venmo|ven mo|paypal|pay pal|e-?mail|correo(?: electronico)?|imel|courriel)/g;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const WRITTEN_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const WRITTEN_HANDLE_RE = /(?<![\w.])@[A-Za-z0-9_-]{5,30}(?![\w@-])/g;
const VENMO_HANDLE_RE = /^@[a-z0-9_-]{5,30}$/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SYMBOL_RES = SYMBOL_WORDS.map(([w, sym]) => [new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'gu'), ` ${sym} `] as const);

/** "at lan dash nguyen 54" → "@lan-nguyen54" (no validation). */
export function spokenToSymbols(spoken: string): string {
  let s = ` ${fold(spoken)} `;
  for (const [re, sym] of SYMBOL_RES) s = s.replace(re, sym);
  const tokens = s
    .split(' ')
    .map((t) => (t.length === 1 ? t : t.replace(/[^\p{L}\p{N}@._+'-]/gu, '').replace(/^'+|[.']+$/g, '')))
    .filter(Boolean);
  // Leading filler words ("is", "es", "là", "se"…) are not part of the handle.
  while (tokens.length && FILLERS.has(tokens[0] as string)) tokens.shift();
  const out: string[] = [];
  for (const t of tokens) {
    if (STOPS.has(t) || out.length >= 16) break;
    out.push(DIGIT_WORDS[t] ?? t);
  }
  return out.join('').replace(/[^a-z0-9@._+-]/g, '');
}

/** Validate + canonicalize a destination for a wallet. Returns null when it is not usable. */
export function canonicalDestination(wallet: Wallet, rawValue: string, typeHint?: RecipientType): DetectedPayout | null {
  const value = /^[@+\w.-]+$/.test(rawValue.trim()) && !/\s/.test(rawValue.trim()) ? rawValue.trim().toLowerCase() : spokenToSymbols(rawValue);
  if (!value) return null;
  if (EMAIL_RE.test(value)) return { wallet, type: 'EMAIL', value };
  const digits = value.replace(/[^\d]/g, '');
  if ((typeHint === 'PHONE' || /^\+?[\d-]+$/.test(value)) && digits.length >= 10 && digits.length <= 15) {
    return { wallet, type: 'PHONE', value: digits.length === 10 ? `+1${digits}` : `+${digits}` };
  }
  if (wallet === 'VENMO') {
    const handle = value.startsWith('@') ? value : `@${value}`;
    if (VENMO_HANDLE_RE.test(handle)) return { wallet, type: 'USER_HANDLE', value: handle };
  }
  return null;
}

const walletFor = (keyword: string): Wallet => (keyword.replace(/\s/g, '') === 'venmo' ? 'VENMO' : 'PAYPAL');

/** Find a payout destination in free text (spoken or written). Keyword-anchored matches win. */
export function detectPayout(text: string): DetectedPayout | null {
  const folded = fold(text);
  for (const m of folded.matchAll(WALLET_RE)) {
    const keyword = m[1] as string;
    const after = folded.slice((m.index ?? 0) + m[0].length).replace(/^[\s,:;-]+/, '');
    // Span ends at a sentence end (". " or end), comma, semicolon or newline. Dots inside an email do not end it.
    const span = after.split(/[.!?](?:\s|$)|[,;\n]/)[0] ?? '';
    const isEmailKeyword = !/venmo|paypal|pay pal|ven mo/.test(keyword);
    // "My PayPal email is …": the wallet keyword is followed by "email"; let the later keyword handle it.
    const candidate = canonicalDestination(walletFor(isEmailKeyword ? 'paypal' : keyword), span);
    if (candidate) return candidate;
  }
  const email = text.match(WRITTEN_EMAIL_RE)?.[0];
  if (email) return { wallet: 'PAYPAL', type: 'EMAIL', value: email.toLowerCase() };
  const handle = text.match(WRITTEN_HANDLE_RE)?.[0];
  if (handle) return { wallet: 'VENMO', type: 'USER_HANDLE', value: handle.toLowerCase() };
  return null;
}

/** Every payout destination mentioned in the text, for grounding checks. */
export function payoutMentions(text: string): string[] {
  const out = new Set<string>();
  const first = detectPayout(text);
  if (first) out.add(first.value);
  for (const m of text.matchAll(WRITTEN_EMAIL_RE)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(WRITTEN_HANDLE_RE)) out.add(m[0].toLowerCase());
  const folded = fold(text);
  for (const m of folded.matchAll(WALLET_RE)) {
    const after = folded.slice((m.index ?? 0) + m[0].length).replace(/^[\s,:;-]+/, '');
    const span = after.split(/[.!?](?:\s|$)|[,;\n]/)[0] ?? '';
    const v = spokenToSymbols(span);
    if (v) out.add(v.startsWith('@') || v.includes('@') ? v : `@${v}`);
  }
  return [...out];
}

const alnum = (s: string): string => fold(s).replace(/[^a-z0-9]/g, '');

/**
 * Is `value` actually in what the person said? Compares on letters+digits only, after turning
 * spoken symbols ("dash", "arroba", "a còng"…) into nothing — so "@lan-nguyen54" is grounded by
 * "at lan dash nguyen 54" but "@x" or a made-up email is not.
 */
export function isGroundedDestination(value: string, sourceText: string): boolean {
  const target = alnum(value);
  if (target.length < 3) return false;
  if (payoutMentions(sourceText).some((m) => alnum(m) === target)) return true;
  let s = ` ${fold(sourceText)} `;
  for (const [re] of SYMBOL_RES) s = s.replace(re, ' ');
  const digitsAsWords = s.split(' ').map((t) => DIGIT_WORDS[t] ?? t).join(' ');
  return alnum(digitsAsWords).includes(target);
}
