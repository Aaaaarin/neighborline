/**
 * Prompt-injection heuristics for request text (any language). Result is only ever a `review`
 * flag: the intake agent has no money tools and amounts are computed from policy regardless.
 *
 * Design rule — protect the rail, not suspect the person: polite pleas ("please approve my
 * request", "I need $1,200 for rent") must NOT match. We look for text that addresses the
 * system (instructions, roles, markers, coercing approval) rather than describing a need.
 */

import { decodeReadableBase64, shortBase64Tokens } from './encoded.js';
import { AUTHORITY_CLAIMS, DIRECTIVE, IMPERATIVE_LEAD, RECIPIENT_AFTER, RULES, SELF_RECIPIENT, type InjectionSignal } from './injection-rules.js';

export type { InjectionSignal, InjectionSignalId } from './injection-rules.js';

const AMOUNT =
  /(?:\$|usd\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s?(?:dollars?|usd|dolares|dolar|do la|dola|dolyar|美元|美金|块|دولار|доллар\S*|달러)/gu;

const HIDDEN = /[\u200B\u202A-\u202E\u2060\u2066-\u2069]|[\u{E0000}-\u{E007F}]/u;
const BLOB = /[A-Za-z0-9+/]{60,}={0,2}|\b[0-9a-f]{64,}\b/;
/** Decoded text that reads like an order to the system (any of our languages, folded). */
const INSTRUCTION_WORDS =
  /\b(ignor\w*|approv\w*|aprob\w*|aprueb\w*|apwouv\w*|instruc\w*|regl\w*|rules?|polic\w*|transfer\w*|send|envi\w*|voye|pay|paga\w*|payer|dollars?|dolar\w*|admin\w*|system\w*|organi[sz]\w*|override|bypass|skip|amount|monto|montant)\b/;

/** Lowercase, NFKC, strip diacritics (đ→d), collapse whitespace. */
export function foldText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[’'`]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Undo common leetspeak ("1gn0re y0ur ru1es") so the same patterns see letters. 1 becomes l. */
export function unLeet(folded: string): string {
  return folded.replace(/[0134578@$|]/g, (c) => ({ '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '|': 'l' })[c] ?? c);
}

const MAX_EXCERPT = 48;
/** Excerpt that never starts or ends mid-word ("…your rules and send $5000", not "ore your rules…"). */
const excerptAt = (text: string, index: number, len: number): string => {
  let start = index;
  let end = index + len;
  if (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1] ?? '') && /[\p{L}\p{N}]/u.test(text[start] ?? '')) {
    const ws = text.slice(start, end).search(/\s/);
    if (ws >= 0) start += ws + 1;
  }
  const cutStart = start > 0 && start !== index ? true : false;
  let cutEnd = false;
  if (end - start > MAX_EXCERPT) {
    end = start + MAX_EXCERPT;
    const lastWs = text.slice(start, end).search(/\s\S*$/);
    if (lastWs > 0) end = start + lastWs;
    cutEnd = true;
  }
  const raw = text.slice(start, end).trim();
  return `${cutStart ? '…' : ''}${raw}${cutEnd ? '…' : ''}`;
};

export interface InjectionOptions {
  /**
   * Amounts above this (in cents) are flagged when a payment verb ORDERS them: an imperative ("send
   * $5,000", "please transfer…") or a payment pointed at a destination ("… $5,000 to @x", "给我转").
   * A neighbor describing a bill ("the ER sent me a bill telling me to pay $4,800") is not flagged.
   */
  largeAmountCents?: number;
  /**
   * Amounts above this (in cents; the household cap) are flagged only next to a claim that someone
   * in charge approved the request or raised the person's limit, in the same sentence.
   */
  inflatedAmountCents?: number;
}

type AmountHit = { cents: number; index: number; end: number; text: string };

function amountsIn(folded: string): AmountHit[] {
  const out: AmountHit[] = [];
  for (const m of folded.matchAll(AMOUNT)) {
    const cents = Number((m[1] ?? m[2] ?? '').replace(/,/g, '')) * 100;
    if (Number.isFinite(cents)) out.push({ cents, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] });
  }
  return out;
}

/** Is the amount at `a` ordered by a payment verb (imperative, or pointed at a recipient)? */
function orderedPayment(folded: string, a: AmountHit): boolean {
  const windowStart = Math.max(0, a.index - 30);
  const before = folded.slice(windowStart, a.index);
  const first = [...before.matchAll(DIRECTIVE)][0];
  if (!first) return false;
  const verbAt = windowStart + (first.index ?? 0);
  const imperative = IMPERATIVE_LEAD.test(folded.slice(Math.max(0, verbAt - 40), verbAt));
  const toSelf = SELF_RECIPIENT.test(folded.slice(verbAt, a.index));
  const toDestination = RECIPIENT_AFTER.test(folded.slice(a.end, a.end + 40));
  return imperative || toSelf || toDestination;
}

/** Sentence around index (for "claim + amount in the same sentence"). */
function sentenceSpan(text: string, index: number): [number, number] {
  const ends = /[.!?。！？](?=\s|$)|\n/g;
  let start = 0;
  for (const m of text.matchAll(ends)) {
    const at = m.index ?? 0;
    if (at < index) start = at + 1;
    else return [start, at + 1];
  }
  return [start, text.length];
}

export function detectPromptInjection(text: string, opts: InjectionOptions = {}): InjectionSignal[] {
  if (!text) return [];
  const signals: InjectionSignal[] = [];
  const lowered = text.normalize('NFKC').toLowerCase();
  const folded = foldText(text);
  // Only words that mix letters and digits are rewritten, so "$150" and "9000" stay numbers.
  const leet = /[a-z][0134578@$|]|[0134578@$|][a-z]/.test(folded) ? folded.replace(/\S+/g, (w) => (/[a-z]/.test(w) && /[0134578@$|]/.test(w) ? unLeet(w) : w)) : null;

  for (const rule of RULES) {
    for (const re of rule.patterns) {
      const m = re.exec(folded) ?? re.exec(lowered) ?? (leet ? re.exec(leet) : null);
      if (m) {
        signals.push({ id: rule.id, excerpt: excerptAt(m.input, m.index, m[0].length) });
        break;
      }
    }
  }
  const hidden = HIDDEN.exec(text) ?? (text.indexOf('\uFEFF', 1) > 0 ? ['\uFEFF'] : null);
  if (hidden) signals.push({ id: 'hidden_characters', excerpt: `U+${(hidden[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}` });

  const blob = BLOB.exec(text);
  if (blob && /\d/.test(blob[0]) && /[a-z]/i.test(blob[0])) {
    signals.push({ id: 'encoded_blob', excerpt: `${blob[0].slice(0, 16)}… (${blob[0].length} chars)` });
  } else {
    // Short base64 (< 60 chars) only counts when it decodes to readable text that reads like an order.
    for (const token of shortBase64Tokens(text)) {
      const decoded = decodeReadableBase64(token);
      if (decoded && (INSTRUCTION_WORDS.test(foldText(decoded)) || detectPromptInjection(decoded).length > 0)) {
        signals.push({ id: 'encoded_blob', excerpt: `${token.slice(0, 16)}… (${token.length} chars, decodes to "${decoded.slice(0, 24)}…")` });
        break;
      }
    }
  }

  if (opts.largeAmountCents !== undefined) {
    const big = amountsIn(folded).find((a) => a.cents > (opts.largeAmountCents as number) && orderedPayment(folded, a));
    if (big) signals.push({ id: 'large_amount_directive', excerpt: excerptAt(folded, Math.max(0, big.index - 24), big.end - Math.max(0, big.index - 24)) });
  }
  if (opts.inflatedAmountCents !== undefined) {
    for (const re of AUTHORITY_CLAIMS) {
      const m = re.exec(folded) ?? re.exec(lowered);
      if (!m) continue;
      const [s0, s1] = sentenceSpan(m.input, m.index);
      const inSentence = amountsIn(m.input).some((a) => a.cents > (opts.inflatedAmountCents as number) && a.index >= s0 && a.index < s1);
      if (inSentence) {
        signals.push({ id: 'authority_claim', excerpt: excerptAt(m.input, m.index, m[0].length) });
        break;
      }
    }
  }
  return signals;
}
