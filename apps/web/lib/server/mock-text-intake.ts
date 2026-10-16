/**
 * Fixture-mode stand-in for the IntakeAgent on free text: keyword category, $ amount and payout
 * handle parsing. The live agent (packages/agents) replaces this with a zod-validated LLM extraction.
 */
import type { IntakeExtraction, Lang, PayoutDestination } from '@neighborline/core';

const CATEGORY_WORDS: Array<[string, RegExp]> = [
  ['medicine_copay', /insulin|medic|pharm|prescri|copay|thuốc|medicina|copago|ensilin|medikaman|famasi/i],
  ['transport', /ride|cab|taxi|bus|gas|dialysis|transport|xe|đi lại|transpò|pasaje/i],
  ['utility_outage', /power|electric|heat|heater|outage|furnace|điện|sưởi|luz|calefac|calentador|kouran|chofaj/i],
  ['groceries', /food|grocer|eat|meal|fridge|ăn|thực phẩm|comida|súper|mercado|manje/i],
];

export function extractFromText(
  text: string,
  lang: Lang,
  prev: IntakeExtraction | null,
): {
  english: string;
  summary: string;
  summaryNative: string;
  category: string;
  requestedCents?: number;
  payout?: PayoutDestination;
} {
  const payout = parsePayout(text) ?? (prev?.payout ? { ...prev.payout } : undefined);
  const category = prev?.category && prev.category !== 'other' ? prev.category : (CATEGORY_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'groceries');
  const amount = text.match(/\$\s?(\d{1,4})(?:[.,](\d{2}))?/);
  const requestedCents = amount ? Number(amount[1]) * 100 + Number(amount[2] ?? 0) : prev?.requestedAmountCents;
  const clean = text.replace(/\s+/g, ' ').trim();
  const summary = clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
  return {
    english: lang === 'en' ? clean : `${clean}\n\n[English translation appears here when live AI is on]`,
    summary: prev ? prev.summaryEn : lang === 'en' ? summary : `(${lang}) ${summary}`,
    summaryNative: prev ? prev.summaryNative : summary,
    category,
    requestedCents,
    payout,
  };
}

export function parsePayout(text: string): PayoutDestination | undefined {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) return { wallet: 'PAYPAL', type: 'EMAIL', value: email[0].toLowerCase() };
  const handle = text.match(/(?:^|\s)@([a-z0-9][a-z0-9_-]{2,29})/i) ?? text.match(/venmo[^a-z0-9@]+(?:is\s+)?@?([a-z0-9][a-z0-9_-]{2,29})/i);
  if (handle) return { wallet: 'VENMO', type: 'USER_HANDLE', value: `@${handle[1]!.toLowerCase()}` };
  const phone = text.match(/(\+?1[\s-.]?)?\(?(\d{3})\)?[\s-.]?(\d{3})[\s-.]?(\d{4})/);
  if (phone) return { wallet: 'PAYPAL', type: 'PHONE', value: `+1${phone[2]}${phone[3]}${phone[4]}` };
  return undefined;
}
