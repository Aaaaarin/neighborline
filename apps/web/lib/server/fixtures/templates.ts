/**
 * Vetted message templates for the web line, in every intake language (copy-status.ts, copy-decline.ts).
 * Each returns the neighbor's text and its English twin for organizers; both come from the same table
 * entry with the same slots. `audience.addressForm` picks the Vietnamese register (bà, ông… / anh, chị,
 * em / neutral "bạn"; core address.ts) and is ignored by every other language.
 */
import { addressed, pickVariant, textFor, type Audience, type Lang, type WithViRegisters } from '@neighborline/core';
import type { DeclineReasonCode } from '../../types';
import { ACK, BLOCKED_REPLY, CLAIM_HELP, CLAIMED, GENERIC_READBACK, NEEDS_PAYOUT, PAID, QUICK_REPLIES, SENDING, type FilledSlots, type Slots } from './copy-status';
import { DECLINE_FINAL, DECLINE_WITH_APPEAL, NOTE_ORIGINAL, NOTE_TRANSLATED, OTHER_NO_NOTE, REASONS } from './copy-decline';

export type { Slots } from './copy-status';

type Pair = { text: string; textEn: string };
const plain = (table: WithViRegisters<string>, lang: Lang, a: Audience): Pair => ({ text: textFor(table, lang, a.addressForm), textEn: table.en });
const filled = (s: Slots): FilledSlots => ({ ...s, tx: s.tx ?? '' });
function withSlots<S>(table: WithViRegisters<(s: S) => string>, lang: Lang, s: S, a: Audience): Pair {
  return { text: addressed(pickVariant(table, lang, a.addressForm)(s), a.addressForm), textEn: table.en(s) };
}

export const ack = (lang: Lang, a: Audience = {}): Pair => plain(ACK, lang, a);
export const sending = (lang: Lang, a: Audience = {}): Pair => plain(SENDING, lang, a);
export const needsPayout = (lang: Lang, a: Audience = {}): Pair => plain(NEEDS_PAYOUT, lang, a);
export const paid = (lang: Lang, s: Slots, a: Audience = {}): Pair => withSlots(PAID, lang, filled(s), a);
export const claimHelp = (lang: Lang, s: Slots, a: Audience = {}): Pair => withSlots(CLAIM_HELP, lang, filled(s), a);
export const claimed = (lang: Lang, s: Slots, a: Audience = {}): Pair => withSlots(CLAIMED, lang, filled(s), a);

export const DECLINE_REASON_LABELS: Record<DeclineReasonCode, string> = {
  outside_area: 'Outside our area',
  household_cap: 'Household reached this month’s limit',
  needs_info: 'Need more information',
  not_covered: 'Not covered by our rules',
  other: 'Something else (write a note)',
};

/** The organizer's free-text note in the neighbor's language (agents translateWithCheck, back-translation checked). */
export interface LocalizedNote {
  text: string;
  /** False: no checked translation (fixture mode, or the check failed), so the original is sent with a line explaining it. */
  translated: boolean;
  backTranslation?: string;
  /** The organizer already wrote it in the neighbor's language: send it as written, no label. */
  alreadyInLanguage?: boolean;
  /** Preview only (live mode): the translation runs when the organizer sends. */
  pending?: boolean;
}

const LANG_EN: Record<Lang, string> = { en: 'English', es: 'Spanish', vi: 'Vietnamese', ht: 'Haitian Creole', zh: 'Chinese', ar: 'Arabic', fr: 'French', tl: 'Tagalog', ko: 'Korean', ru: 'Russian' };

/**
 * The note lines under a decline. English neighbors (and notes already in their language, `translated`
 * false with the same text) get the note as written. Otherwise a checked translation with a label in
 * their language, or, when there is none, the original with a line in their language saying it is in
 * English and offering help. The organizer's twin (`textEn`) always shows the note as written plus what
 * was sent.
 */
function noteLines(lang: Lang, note: string, local: LocalizedNote | undefined, a: Audience): Pair {
  const asWritten = `\n\n“${note}”`;
  if (lang === 'en' || local?.alreadyInLanguage) return { text: asWritten, textEn: asWritten };
  if (local?.translated && local.text.trim()) {
    const back = local.backTranslation ? ` Back-translation: “${local.backTranslation}”` : '';
    return {
      text: `\n\n${NOTE_TRANSLATED[lang]}\n“${local.text.trim()}”`,
      textEn: `${asWritten}\n(Sent to them in ${LANG_EN[lang]}, translated automatically.${back})`,
    };
  }
  if (local?.pending) {
    return {
      text: `\n\n${textFor(NOTE_ORIGINAL, lang, a.addressForm)}\n“${note}”`,
      textEn: `${asWritten}\n(When you send, this note is translated into ${LANG_EN[lang]} and checked by back-translation. If the check fails, they get it in English with a line in ${LANG_EN[lang]} offering help, as shown.)`,
    };
  }
  return {
    text: `\n\n${textFor(NOTE_ORIGINAL, lang, a.addressForm)}\n“${note}”`,
    textEn: `${asWritten}\n(No checked ${LANG_EN[lang]} translation was available, so they got it in English with a line in ${LANG_EN[lang]} offering help.)`,
  };
}

/**
 * The decline the neighbor receives. The first one offers an appeal (reply REVIEW → a different organizer
 * looks again). `final`: a second organizer already looked again, so no further appeal is promised.
 */
export function declined(lang: Lang, code: DeclineReasonCode, note?: string, opts: { final?: boolean; noteLocal?: LocalizedNote } & Audience = {}): Pair {
  const reasons = code === 'other' && !note ? OTHER_NO_NOTE : REASONS[code];
  const body = opts.final ? DECLINE_FINAL : DECLINE_WITH_APPEAL;
  const reason = textFor(reasons, lang, opts.addressForm);
  const text = addressed(pickVariant(body, lang, opts.addressForm)(reason), opts.addressForm);
  const n = note?.trim() ? noteLines(lang, note.trim(), opts.noteLocal, opts) : { text: '', textEn: '' };
  return { text: text + n.text, textEn: body.en(reasons.en) + n.textEn };
}

export const quickReplies = (lang: Lang): { yes: string; fix: string } => QUICK_REPLIES[lang];

/** Read-back for free text in fixture mode (no live translation available). */
export function genericReadback(lang: Lang, s: { summary: string; categoryLabel: string; cap: string; payout?: string }, a: Audience = {}): Pair {
  return withSlots(GENERIC_READBACK, lang, { summary: s.summary, categoryLabel: s.categoryLabel, cap: s.cap, dest: s.payout ?? '' }, a);
}

/** Reply when rail protection stops a request at intake (lookalike / impersonation). No money moves. */
export const blockedReply = (lang: Lang, a: Audience = {}): Pair => plain(BLOCKED_REPLY, lang, a);
