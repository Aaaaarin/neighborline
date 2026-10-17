/**
 * Respectful address for Vietnamese neighbors. Vietnamese has no neutral "you": a service that answers
 * an older woman who calls herself "bà" with "bạn" sounds cold or rude. So every Vietnamese text that
 * talks to the neighbor exists in up to three vetted variants, written whole (not patched word by word):
 *
 *   vi       neutral   "bạn" + "chúng tôi"                      (no form known: the safe default)
 *   viElder  elder     bà / ông / cô / chú / bác + "chúng cháu", "ạ"  (the volunteers speak as juniors)
 *   viPeer   peer      anh / chị / em + "chúng tôi"
 *
 * Variant texts name the person with the slots {you} (mid-sentence) and {You} (sentence start), filled
 * with the extracted form. Other languages are unaffected: they have one polite register each. Pure.
 */
import type { AddressForm, Lang } from './schemas.js';

export type ViRegister = 'neutral' | 'elder' | 'peer';

const ELDER: ReadonlySet<AddressForm> = new Set(['bà', 'ông', 'cô', 'chú', 'bác']);
const PEER: ReadonlySet<AddressForm> = new Set(['anh', 'chị', 'em']);

export function viRegister(form?: AddressForm | null): ViRegister {
  if (!form) return 'neutral';
  if (ELDER.has(form)) return 'elder';
  if (PEER.has(form)) return 'peer';
  return 'neutral';
}

/** How the volunteers refer to themselves in that register (for docs and tests; the variants spell it out). */
export const viSelf = (form?: AddressForm | null): 'chúng cháu' | 'chúng tôi' => (viRegister(form) === 'elder' ? 'chúng cháu' : 'chúng tôi');

/** A text in every language, plus optional Vietnamese register variants. */
export type WithViRegisters<T> = Readonly<Record<Lang, T>> & { readonly viElder?: T; readonly viPeer?: T };

/** Who the text is for. `addressForm` matters only for Vietnamese. */
export interface Audience {
  addressForm?: AddressForm | null | undefined;
}

/**
 * The variant for this language and form: Vietnamese elder/peer variants when the form calls for one and
 * the table has it, otherwise the language's own text.
 */
export function pickVariant<T>(table: WithViRegisters<T>, lang: Lang, form?: AddressForm | null): T {
  if (lang === 'vi') {
    const reg = viRegister(form);
    if (reg === 'elder' && table.viElder !== undefined) return table.viElder;
    if (reg === 'peer' && table.viPeer !== undefined) return table.viPeer;
  }
  return table[lang];
}

const capitalize = (s: string): string => (s ? s[0]!.toLocaleUpperCase('vi') + s.slice(1) : s);

/**
 * Fill {you} / {You} with the address form. Text without those slots is returned unchanged; a variant
 * with slots but no form (a bug) falls back to the neutral "bạn" rather than showing a brace.
 */
export function addressed(text: string, form?: AddressForm | null): string {
  if (!text.includes('{you}') && !text.includes('{You}')) return text;
  const you = form ?? 'bạn';
  return text.replace(/\{you\}/g, you).replace(/\{You\}/g, capitalize(you));
}

/** pickVariant + addressed, for plain-string tables. */
export function textFor(table: WithViRegisters<string>, lang: Lang, form?: AddressForm | null): string {
  return addressed(pickVariant(table, lang, form), form);
}
