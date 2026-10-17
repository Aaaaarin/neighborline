/**
 * What the neighbor sees from PayPal / Venmo itself: the payout email subject and the per-item note
 * (Venmo shows the note in the app and requires one). Written natively for every intake language, so
 * a neighbor who asked in Vietnamese is not greeted by an English-only payment.
 *
 * Limits are PayPal's (packages/paypal/PAYPAL_NOTES.md): `note` ≤ 4000 characters when ASCII, ≤ 1000
 * when it contains any non-ASCII character; `email_subject` ≤ 255. The English copy is pure ASCII and
 * is the fallback whenever a localized text would not fit. Pure: no I/O.
 */
import { textFor, type WithViRegisters } from './address.js';
import { LANGS, type AddressForm, type Lang } from './schemas.js';

export const PAYPAL_NOTE_MAX_ASCII = 4000;
export const PAYPAL_NOTE_MAX_NON_ASCII = 1000;
export const PAYPAL_EMAIL_SUBJECT_MAX = 255;

/**
 * {group} is the group's name. Arabic isolates it left-to-right (U+2066 … U+2069), as the SMS templates do.
 * Vietnamese has elder / peer variants ({you} = bà, ông, chị…; address.ts).
 */
const SUBJECT: WithViRegisters<string> = {
  en: 'Your neighbors at {group} sent you help',
  es: 'Sus vecinos de {group} le enviaron ayuda',
  vi: 'Hàng xóm ở {group} đã gửi tiền giúp bạn',
  viElder: 'Bà con hàng xóm ở {group} gửi tiền giúp {you}',
  viPeer: 'Hàng xóm ở {group} đã gửi tiền giúp {you}',
  ht: 'Vwazen ou yo nan {group} voye yon èd ba ou',
  zh: '{group} 的邻居们给您送来了帮助',
  ar: 'جيرانك في ⁦{group}⁩ أرسلوا لك مساعدة',
  fr: "Vos voisins de {group} vous ont envoyé de l'aide",
  tl: 'Nagpadala ng tulong ang iyong mga kapitbahay sa {group}',
  ko: '{group} 이웃들이 도움을 보냈습니다',
  ru: 'Ваши соседи из {group} отправили вам помощь',
};
const NOTE: WithViRegisters<string> = {
  en: 'Mutual aid from your neighbors at {group}. No need to pay it back.',
  es: 'Ayuda mutua de sus vecinos de {group}. No tiene que devolverla.',
  vi: 'Tiền hỗ trợ từ hàng xóm của bạn ở {group}. Bạn không cần trả lại.',
  viElder: 'Tiền hỗ trợ từ bà con hàng xóm ở {group}. {You} không cần trả lại ạ.',
  viPeer: 'Tiền hỗ trợ từ hàng xóm của {you} ở {group}. {You} không cần trả lại.',
  ht: 'Èd mityèl vwazen ou yo nan {group} voye ba ou. Ou pa bezwen remèt li.',
  zh: '这是 {group} 的邻居们给您的互助款，不需要归还。',
  ar: 'مساعدة متبادلة من جيرانك في ⁦{group}⁩. لا داعي لردّها.',
  fr: "Entraide de vos voisins de {group}. Vous n'avez rien à rembourser.",
  tl: 'Tulong mula sa iyong mga kapitbahay sa {group}. Hindi mo na kailangang ibalik ito.',
  ko: '{group} 이웃들이 보내는 상호부조 지원금입니다. 갚지 않으셔도 됩니다.',
  ru: 'Взаимопомощь от ваших соседей из {group}. Возвращать не нужно.',
};
export const isAsciiText = (s: string): boolean => /^[\x00-\x7f]*$/.test(s);

/** One line, NFC, no control characters (they can break a PayPal email header or a Venmo feed line). */
export function cleanPayPalText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The PayPal limit for a note with this text: 4000 if every character is ASCII, else 1000. */
export const payPalNoteLimit = (note: string): number => (isAsciiText(note) ? PAYPAL_NOTE_MAX_ASCII : PAYPAL_NOTE_MAX_NON_ASCII);

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair; marks the cut with "...". */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > max - 3) break;
    out += ch;
  }
  return `${out.trimEnd()}...`;
}

const langOf = (lang: Lang | string): Lang => {
  const primary = String(lang).toLowerCase().split(/[-_]/)[0] ?? 'en';
  return (LANGS as readonly string[]).includes(primary) ? (primary as Lang) : 'en';
};

const fill = (template: string, group: string): string => template.replace('{group}', group);
const subjectFor = (l: Lang, form?: AddressForm | null): string => textFor(SUBJECT, l, form);
const noteFor = (l: Lang, form?: AddressForm | null): string => textFor(NOTE, l, form);

export interface PayoutCopy {
  /** The language actually used (English when the request's language has no copy or nothing fits). */
  lang: Lang;
  emailSubject: string;
  note: string;
}

/**
 * Subject and Venmo/PayPal note in the neighbor's language (and, in Vietnamese, their address form),
 * within PayPal's limits. If the localized text would not fit (a very long group name), the ASCII
 * English text is used, clamped to its limit.
 */
export function payoutCopy(lang: Lang | string, groupName: string, addressForm?: AddressForm | null): PayoutCopy {
  const group = cleanPayPalText(groupName) || 'your neighbors';
  const l = langOf(lang);
  const subject = cleanPayPalText(fill(subjectFor(l, addressForm), group));
  const note = cleanPayPalText(fill(noteFor(l, addressForm), group));
  if (subject.length <= PAYPAL_EMAIL_SUBJECT_MAX && note.length <= payPalNoteLimit(note)) return { lang: l, emailSubject: subject, note };
  const enSubject = cleanPayPalText(fill(SUBJECT.en, group));
  const enNote = cleanPayPalText(fill(NOTE.en, group));
  return { lang: 'en', emailSubject: clampText(enSubject, PAYPAL_EMAIL_SUBJECT_MAX), note: clampText(enNote, payPalNoteLimit(enNote)) };
}

/** One neighbor in a batch: a language, or a language and (Vietnamese) address form. */
export type BatchAudience = Lang | string | { lang: Lang | string; addressForm?: AddressForm | null | undefined };

/**
 * PayPal has ONE email subject per batch. When every neighbor in the batch asked in the same language
 * it is in that language (with their address form when they all share it, else the neutral one); a
 * batch that mixes languages gets the English subject (each item's note is still in its neighbor's
 * language).
 */
export function batchEmailSubject(audience: readonly BatchAudience[], groupName: string): string {
  const all = audience.map((a) => (typeof a === 'string' ? { lang: langOf(a), form: undefined } : { lang: langOf(a.lang), form: a.addressForm ?? undefined }));
  const langs = new Set(all.map((a) => a.lang));
  const only = langs.size === 1 ? [...langs][0]! : 'en';
  const forms = new Set(all.map((a) => a.form));
  return payoutCopy(only, groupName, forms.size === 1 ? [...forms][0] : undefined).emailSubject;
}
