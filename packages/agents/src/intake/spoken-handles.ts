/**
 * Payout handles and emails spoken aloud, in several languages:
 *   "my Venmo is at lan dash nguyen 54"                        → VENMO  @lan-nguyen54
 *   "Venmo của tôi là a còng lan gạch ngang nguyen 54"         → VENMO  @lan-nguyen54
 *   "mi correo de PayPal es rosa punto m punto delgado arroba example punto com"
 *                                                              → PAYPAL rosa.m.delgado@example.com
 *   "Venmo mwen se arobaz jean tire baptiste tire h"           → VENMO  @jean-baptiste-h
 *   "벤모에 등록된 전화번호는 425 555 0139 이에요"                → VENMO  +14255550139
 * Deterministic: used to normalize what the model extracted AND to check it is grounded in what
 * the person actually said (the model must never invent a payout destination). The vocabulary per
 * language lives in spoken-vocab.ts.
 */
import { DEFAULT_PHONE_REGION, latinizeLookalikes, phonesInText, PHONE_REGIONS, toE164, type RecipientType, type Wallet } from '@neighborline/core';
import { DIGIT_WORDS, FILLERS, SPOKEN_SYMBOLS, STOPS, WALLET_NAMES } from './spoken-vocab.js';

export interface DetectedPayout {
  wallet: Wallet;
  type: RecipientType;
  value: string;
}

/** Options shared by the functions below. */
export interface HandleOptions {
  /** Region a phone number without a country code is read in (ISO 3166 code). Default US. */
  phoneRegion?: string;
}

/** Lowercase, strip diacritics (đ→d), unify apostrophes, collapse whitespace. */
export const fold = (s: string): string =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * fold() for destinations: first map lookalike letters inside Latin words to Latin ("mutuaіd" with a
 * Cyrillic і → "mutuaid"), so stripping non-Latin characters later cannot turn an impersonating
 * handle into a different one the lookalike check no longer recognizes.
 */
const foldDest = (s: string): string => fold(latinizeLookalikes(s));

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HAN = /\p{Script=Han}/u;

/** Every spoken symbol word, folded, longest first; Han-script words match without word boundaries. */
const SYMBOL_RES: ReadonlyArray<readonly [RegExp, string]> = (() => {
  const seen = new Map<string, string>();
  for (const table of Object.values(SPOKEN_SYMBOLS)) {
    for (const [sym, words] of Object.entries(table)) for (const w of words) seen.set(fold(w), sym);
  }
  return [...seen.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([w, sym]) => [HAN.test(w) ? new RegExp(escapeRe(w), 'gu') : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'gu'), sym] as const);
})();
const FILLER_SET = new Set(Object.values(FILLERS).flat().map(fold));
const STOP_SET = new Set(STOPS.map(fold));

const WALLET_OF = new Map<string, Wallet | 'EMAIL'>();
for (const [wallet, names] of Object.entries(WALLET_NAMES)) for (const n of names) WALLET_OF.set(fold(n), wallet as Wallet | 'EMAIL');
const WALLET_RE = new RegExp(`(${[...WALLET_OF.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`, 'gu');

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const WRITTEN_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const WRITTEN_HANDLE_RE = /(?<![\w.])@[A-Za-z0-9_-]{5,30}(?![\w@-])/g;
const VENMO_HANDLE_RE = /^@[a-z0-9_-]{5,30}$/;
/** A destination is said up to a sentence end, comma, semicolon or newline (Latin, CJK and Arabic punctuation). */
const SPAN_END = /[.!?](?:\s|$)|[,;\n。、，；！？،؛؟]/;

/** "at lan dash nguyen 54" → "@lan-nguyen54" (no validation). */
export function spokenToSymbols(spoken: string): string {
  let s = ` ${foldDest(spoken)} `;
  for (const [re, sym] of SYMBOL_RES) s = s.replace(re, ` ${sym} `);
  const tokens = s
    .split(' ')
    .map((t) => (t.length === 1 ? t : t.replace(/[^\p{L}\p{N}@._+'-]/gu, '').replace(/^'+|[.']+$/g, '')))
    .filter(Boolean);
  // Leading filler words ("is", "es", "là", "c'est le", "ko po ay"…) are not part of the destination.
  while (tokens.length && FILLER_SET.has(tokens[0] as string)) tokens.shift();
  const out: string[] = [];
  for (const t of tokens) {
    if (STOP_SET.has(t) || out.length >= 16) break;
    // Only Latin letters, digits and symbols can be in a handle: words in another script ("мой", "是") drop out whole.
    const latin = (DIGIT_WORDS[t] ?? t).replace(/[^a-z0-9@._+-]/g, '');
    if (latin) out.push(latin);
  }
  // "Venmo me at my cell": "at" before "my"/"the"/"mi"… is a preposition, so no handle was spelled here.
  const atIdx = out.indexOf('@');
  if (atIdx >= 0 && FILLER_SET.has(tokens[tokens.indexOf('@') + 1] ?? '')) return '';
  const joined = out.join('');
  // "… at lorna dash santos": an "@" that is not between a local part and a domain starts a handle,
  // so whatever was said before it is not part of the handle.
  const at = joined.indexOf('@');
  if (at > 0 && !/@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(joined)) return joined.slice(at);
  return joined;
}

/** Phone to E.164: the region's rules first; a long number with no region match is taken as international. */
function phoneValue(raw: string, region: string): string | null {
  const e164 = toE164(raw, region);
  if (e164) return e164;
  const digits = raw.replace(/\D/g, '');
  return !/[\p{L}]/u.test(raw) && digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
}

/** Validate + canonicalize a destination for a wallet. Returns null when it is not usable. */
export function canonicalDestination(wallet: Wallet, rawValue: string, typeHint?: RecipientType, opts: HandleOptions = {}): DetectedPayout | null {
  const region = opts.phoneRegion ?? DEFAULT_PHONE_REGION;
  const raw = rawValue.trim();
  if ((typeHint === 'PHONE' || /^\+?[\d\s().-]+$/.test(raw)) && /\d/.test(raw)) {
    const phone = phoneValue(raw, region);
    if (phone) return { wallet, type: 'PHONE', value: phone };
    if (typeHint === 'PHONE') return null;
  }
  const value = /^[@+\w.-]+$/.test(raw) ? raw.toLowerCase() : spokenToSymbols(raw);
  if (!value) return null;
  // Digits said as words ("cinco cero tres …") come out as a digit string: a phone, not "@5035550147".
  if (/^\+?\d{10,15}$/.test(value)) {
    const phone = phoneValue(value, region);
    if (phone) return { wallet, type: 'PHONE', value: phone };
  }
  if (EMAIL_RE.test(value)) return { wallet, type: 'EMAIL', value };
  if (wallet === 'VENMO') {
    const handle = value.startsWith('@') ? value : `@${value}`;
    if (VENMO_HANDLE_RE.test(handle)) return { wallet, type: 'USER_HANDLE', value: handle };
  }
  return null;
}

interface WalletSpan {
  wallet: Wallet;
  index: number;
  span: string;
}

/** Each wallet keyword in the (folded) text with what follows it up to the end of the clause. */
function walletSpans(folded: string): WalletSpan[] {
  const out: WalletSpan[] = [];
  for (const m of folded.matchAll(WALLET_RE)) {
    const kind = WALLET_OF.get(m[1] as string) ?? 'PAYPAL';
    const after = folded.slice((m.index ?? 0) + m[0].length).replace(/^[\s,:;-]+/, '');
    out.push({ wallet: kind === 'EMAIL' ? 'PAYPAL' : kind, index: m.index ?? 0, span: after.split(SPAN_END)[0] ?? '' });
  }
  return out;
}

/** What the span after a wallet keyword names: a written email/handle, a phone number, or a spoken destination. */
function destinationInSpan(w: WalletSpan, region: string): DetectedPayout | null {
  const email = w.span.match(WRITTEN_EMAIL_RE)?.[0];
  if (email) return { wallet: w.wallet, type: 'EMAIL', value: email.toLowerCase() };
  const handle = w.span.match(WRITTEN_HANDLE_RE)?.[0];
  if (handle && w.wallet === 'VENMO') return { wallet: w.wallet, type: 'USER_HANDLE', value: handle.toLowerCase() };
  const spoken = spokenToSymbols(w.span);
  if (!spoken.includes('@')) {
    // "Mon numéro Venmo est le 857 555 0148": a phone-shaped run is a phone, not "@le8575550148".
    const phones = phonesInText(w.span, region);
    if (phones.length === 1) return { wallet: w.wallet, type: 'PHONE', value: phones[0] as string };
  }
  return canonicalDestination(w.wallet, w.span, undefined, { phoneRegion: region });
}

/** Find a payout destination in free text (spoken or written). Keyword-anchored matches win. */
export function detectPayout(text: string, opts: HandleOptions = {}): DetectedPayout | null {
  const region = opts.phoneRegion ?? DEFAULT_PHONE_REGION;
  const folded = foldDest(text);
  const spans = walletSpans(folded);
  for (const w of spans) {
    const found = destinationInSpan(w, region);
    if (found) return found;
  }
  const email = folded.match(WRITTEN_EMAIL_RE)?.[0];
  if (email) return { wallet: 'PAYPAL', type: 'EMAIL', value: email };
  const handle = folded.match(WRITTEN_HANDLE_RE)?.[0];
  if (handle) return { wallet: 'VENMO', type: 'USER_HANDLE', value: handle };
  // "You can Venmo my phone number, 503 555 0147": a wallet is named and exactly one phone number is said.
  const phones = phonesInText(text, region);
  const named = spans[0];
  if (named && phones.length === 1) return { wallet: named.wallet, type: 'PHONE', value: phones[0] as string };
  return null;
}

/**
 * The one destination the text spells out unambiguously (a written email, a written @handle or a
 * phone number), or null when there is none or more than one. Never a destination pieced together
 * from spoken fragments: this is what may replace a model's answer that failed grounding.
 */
export function unambiguousWrittenPayout(text: string, opts: HandleOptions = {}): DetectedPayout | null {
  const region = opts.phoneRegion ?? DEFAULT_PHONE_REGION;
  const folded = foldDest(text);
  const written = new Set<string>([
    ...[...folded.matchAll(WRITTEN_EMAIL_RE)].map((m) => m[0]),
    ...[...folded.matchAll(WRITTEN_HANDLE_RE)].map((m) => m[0]),
    ...phonesInText(text, region),
  ]);
  if (written.size !== 1) return null;
  // Any other destination said after a wallet name ("my sister's Venmo is at …") makes it ambiguous.
  const said = walletSpans(folded).map((w) => destinationInSpan(w, region)?.value).filter((v): v is string => Boolean(v));
  if (said.some((v) => !written.has(v))) return null;
  const found = detectPayout(text, opts);
  return found && written.has(found.value) ? found : null;
}

/** Every payout destination mentioned in the text, for grounding checks. */
export function payoutMentions(text: string, opts: HandleOptions = {}): string[] {
  const region = opts.phoneRegion ?? DEFAULT_PHONE_REGION;
  const out = new Set<string>();
  const first = detectPayout(text, opts);
  if (first) out.add(first.value);
  const folded = foldDest(text);
  for (const m of folded.matchAll(WRITTEN_EMAIL_RE)) out.add(m[0]);
  for (const m of folded.matchAll(WRITTEN_HANDLE_RE)) out.add(m[0]);
  for (const p of phonesInText(text, region)) out.add(p);
  for (const w of walletSpans(folded)) {
    const v = spokenToSymbols(w.span);
    if (v) out.add(v.startsWith('@') || v.includes('@') ? v : `@${v}`);
  }
  return [...out];
}

const alnum = (s: string): string => foldDest(s).replace(/[^a-z0-9]/g, '');

/** Digits as said, in order, with spoken digit words ("cinco") turned into digits. */
const digitStream = (s: string): string =>
  fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => DIGIT_WORDS[t] ?? t)
    .join(' ')
    .replace(/\D/g, '');

/**
 * Is `value` actually in what the person said? Phones compare as numbers: "+15035550147" is
 * grounded by "503 555 0147" (the default region's country code is implied). Handles and emails
 * compare on letters+digits only, after turning spoken symbols ("dash", "arroba", "a còng"…) into
 * nothing, so "@lan-nguyen54" is grounded by "at lan dash nguyen 54" but "@x" or a made-up email is not.
 */
export function isGroundedDestination(value: string, sourceText: string, opts: HandleOptions = {}): boolean {
  const region = opts.phoneRegion ?? DEFAULT_PHONE_REGION;
  if (/^\+\d{8,15}$/.test(value)) {
    if (phonesInText(sourceText, region).includes(value)) return true;
    const code = PHONE_REGIONS[region.toUpperCase()]?.callingCode ?? '1';
    const digits = value.slice(1);
    const national = digits.startsWith(code) ? digits.slice(code.length) : null;
    const stream = digitStream(sourceText);
    return stream.includes(digits) || (national !== null && national.length >= 7 && stream.includes(national));
  }
  const target = alnum(value);
  if (target.length < 3) return false;
  if (payoutMentions(sourceText, opts).some((m) => alnum(m) === target)) return true;
  let s = ` ${foldDest(sourceText)} `;
  for (const [re] of SYMBOL_RES) s = s.replace(re, ' ');
  const digitsAsWords = s.split(' ').map((t) => DIGIT_WORDS[t] ?? t).join(' ');
  return alnum(digitsAsWords).includes(target);
}
