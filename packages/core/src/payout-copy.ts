/**
 * What the neighbor sees from PayPal / Venmo itself: the payout email subject and the per-item note
 * (Venmo shows the note in the app and requires one). Written natively for every intake language, so
 * a neighbor who asked in Vietnamese is not greeted by an English-only payment.
 *
 * Limits are PayPal's (packages/paypal/PAYPAL_NOTES.md): `note` ≤ 4000 characters when ASCII, ≤ 1000
 * when it contains any non-ASCII character; `email_subject` ≤ 255. The English copy is pure ASCII and
 * is the fallback whenever a localized text would not fit. Pure: no I/O.
 */
import { LANGS, type Lang } from './schemas.js';

export const PAYPAL_NOTE_MAX_ASCII = 4000;
export const PAYPAL_NOTE_MAX_NON_ASCII = 1000;
export const PAYPAL_EMAIL_SUBJECT_MAX = 255;

/** {group} is the group's name. Arabic isolates it left-to-right (U+2066 … U+2069), as the SMS templates do. */
const COPY: Readonly<Record<Lang, { subject: string; note: string }>> = {
  en: { subject: 'Your neighbors at {group} sent you help', note: 'Mutual aid from your neighbors at {group}. No need to pay it back.' },
  es: { subject: 'Sus vecinos de {group} le enviaron ayuda', note: 'Ayuda mutua de sus vecinos de {group}. No tiene que devolverla.' },
  vi: { subject: 'Hàng xóm ở {group} đã gửi tiền giúp bạn', note: 'Tiền hỗ trợ từ hàng xóm của bạn ở {group}. Bạn không cần trả lại.' },
  ht: { subject: 'Vwazen ou yo nan {group} voye yon èd ba ou', note: 'Èd mityèl vwazen ou yo nan {group} voye ba ou. Ou pa bezwen remèt li.' },
  zh: { subject: '{group} 的邻居们给您送来了帮助', note: '这是 {group} 的邻居们给您的互助款，不需要归还。' },
  ar: { subject: 'جيرانك في ⁦{group}⁩ أرسلوا لك مساعدة', note: 'مساعدة متبادلة من جيرانك في ⁦{group}⁩. لا داعي لردّها.' },
  fr: { subject: "Vos voisins de {group} vous ont envoyé de l'aide", note: "Entraide de vos voisins de {group}. Vous n'avez rien à rembourser." },
  tl: { subject: 'Nagpadala ng tulong ang iyong mga kapitbahay sa {group}', note: 'Tulong mula sa iyong mga kapitbahay sa {group}. Hindi mo na kailangang ibalik ito.' },
  ko: { subject: '{group} 이웃들이 도움을 보냈습니다', note: '{group} 이웃들이 보내는 상호부조 지원금입니다. 갚지 않으셔도 됩니다.' },
  ru: { subject: 'Ваши соседи из {group} отправили вам помощь', note: 'Взаимопомощь от ваших соседей из {group}. Возвращать не нужно.' },
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

export interface PayoutCopy {
  /** The language actually used (English when the request's language has no copy or nothing fits). */
  lang: Lang;
  emailSubject: string;
  note: string;
}

/**
 * Subject and Venmo/PayPal note in the neighbor's language, within PayPal's limits. If the localized
 * text would not fit (a very long group name), the ASCII English text is used, clamped to its limit.
 */
export function payoutCopy(lang: Lang | string, groupName: string): PayoutCopy {
  const group = cleanPayPalText(groupName) || 'your neighbors';
  const l = langOf(lang);
  const subject = cleanPayPalText(fill(COPY[l].subject, group));
  const note = cleanPayPalText(fill(COPY[l].note, group));
  if (subject.length <= PAYPAL_EMAIL_SUBJECT_MAX && note.length <= payPalNoteLimit(note)) return { lang: l, emailSubject: subject, note };
  const enSubject = cleanPayPalText(fill(COPY.en.subject, group));
  const enNote = cleanPayPalText(fill(COPY.en.note, group));
  return { lang: 'en', emailSubject: clampText(enSubject, PAYPAL_EMAIL_SUBJECT_MAX), note: clampText(enNote, payPalNoteLimit(enNote)) };
}

/**
 * PayPal has ONE email subject per batch. When every neighbor in the batch asked in the same language
 * it is in that language; a batch that mixes languages gets the English subject (each item's note is
 * still in its neighbor's language).
 */
export function batchEmailSubject(langs: readonly (Lang | string)[], groupName: string): string {
  const distinct = new Set(langs.map(langOf));
  const only = distinct.size === 1 ? [...distinct][0]! : 'en';
  return payoutCopy(only, groupName).emailSubject;
}
