/**
 * Translation for languages outside the vetted catalog, with a back-translation check:
 *   English text → target language → back to English, then every key fact (amount, wallet,
 *   handle) must appear verbatim in the translation AND in the back-translation. If not, the
 *   caller sends the vetted English text instead of a possibly wrong translation.
 */
import { z } from 'zod';
import type { LLM } from './providers/types.js';
import { DATA_NOT_INSTRUCTIONS, dataBlock } from './prompt-safety.js';
import { langName } from './lang.js';
import { runStructured, type StructuredTrace } from './validate.js';

export const TranslationOut = z.object({ translation: z.string().min(1).max(2000) });
export const BackTranslationOut = z.object({ english: z.string().min(1).max(2000) });

export interface FactCheck {
  facts: string[];
  missingInTranslation: string[];
  missingInBackTranslation: string[];
  ok: boolean;
}
export interface TranslationResult {
  ok: boolean;
  text: string;
  /** False when the text is unchanged English (fixture identity or failed check). */
  translated: boolean;
  backTranslation?: string;
  check?: FactCheck;
  traces: StructuredTrace[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-token match: "$150" is not found in "$1500" or "$150.50"; "Venmo" not in "Venmos". */
const has = (hay: string, needle: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}]|[.,]\\d)`, 'iu').test(hay);

export function checkFacts(facts: readonly string[], translation: string, backTranslation: string): FactCheck {
  const missingInTranslation = facts.filter((f) => !has(translation, f));
  const missingInBackTranslation = facts.filter((f) => !has(backTranslation, f));
  return { facts: [...facts], missingInTranslation, missingInBackTranslation, ok: missingInTranslation.length === 0 && missingInBackTranslation.length === 0 };
}

/**
 * The facts in a free-text note (an organizer's decline note) that a translation must keep verbatim:
 * money amounts, emails, @handles, URLs, phone numbers and other numbers (dates, counts, hours).
 * Emails are taken first so their parts are not counted twice as a handle or a number.
 */
export function noteFacts(text: string): string[] {
  const facts: string[] = [];
  let rest = text;
  const take = (re: RegExp) => {
    rest = rest.replace(re, (m) => {
      const f = m.replace(/[.,;:!?)]+$/, '');
      if (f && !facts.includes(f)) facts.push(f);
      return ' ';
    });
  };
  take(/https?:\/\/[^\s"“”]+/giu);
  take(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu);
  take(/(?<![\p{L}\p{N}])@[A-Za-z0-9][\w.-]*/gu);
  take(/\$\s?\d[\d,]*(?:\.\d+)?/gu);
  take(/\+?\d[\d ().-]{6,}\d/gu);
  take(/(?<![\p{L}\p{N}])\d+(?:[.,:]\d+)*(?![\p{L}\p{N}])/gu);
  return facts;
}

export async function translateWithCheck(
  llm: LLM,
  args: { text: string; targetLang: string; facts: readonly string[]; tone?: string },
): Promise<TranslationResult> {
  const target = langName(args.targetLang);
  const forward = await runStructured({
    llm,
    schema: TranslationOut,
    schemaName: 'Translation',
    label: `translate → ${args.targetLang}`,
    system: [
      `You translate short messages from a neighborhood mutual-aid group into ${target} (${args.targetLang}).`,
      DATA_NOT_INSTRUCTIONS,
      `Tone: ${args.tone ?? 'warm, plain, respectful; short sentences; no jargon'}.`,
      'Keep these exactly as written (do not translate, reformat or convert): money amounts like "$150", brand names PayPal and Venmo, usernames, emails, phone numbers, URLs.',
      'Translate only; do not add or remove information.',
    ].join('\n'),
    messages: [{ role: 'user', content: `${dataBlock('source_text', args.text)}\nLanguage: ${args.targetLang}` }],
    semanticCheck: (v) =>
      args.facts.filter((f) => !has(v.translation, f)).map((f) => ({ path: 'translation', source: 'semantic' as const, message: `must contain "${f}" exactly as written` })),
  });
  if (!forward.ok) return { ok: false, text: args.text, translated: false, traces: [forward.trace] };
  if (forward.value.translation.trim() === args.text.trim()) {
    return { ok: true, text: args.text, translated: false, traces: [forward.trace] };
  }
  const back = await runStructured({
    llm,
    schema: BackTranslationOut,
    schemaName: 'BackTranslation',
    label: `back-translate ${args.targetLang} → en`,
    system: [
      'Translate the text into English as literally as possible, for a fact check.',
      DATA_NOT_INSTRUCTIONS,
      'Keep amounts, brand names, usernames, emails and phone numbers exactly as written.',
    ].join('\n'),
    messages: [{ role: 'user', content: dataBlock('text', forward.value.translation) }],
    maxRepairs: 0,
  });
  const traces = [forward.trace, back.trace];
  if (!back.ok) return { ok: false, text: args.text, translated: false, traces };
  const check = checkFacts(args.facts, forward.value.translation, back.value.english);
  return check.ok
    ? { ok: true, text: forward.value.translation, translated: true, backTranslation: back.value.english, check, traces }
    : { ok: false, text: args.text, translated: false, backTranslation: back.value.english, check, traces };
}
