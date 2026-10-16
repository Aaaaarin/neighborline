/**
 * Read-back framing and clarifying questions. Vetted strings only: the catalog phrases come from
 * core's i18n (readback_intro, ask_payout, ask_household); the few intake-only phrases live here
 * in the same languages (CATALOG_LANGS). The model contributes only `summaryNative`.
 */
import { isCatalogLang, render, type CatalogLang, type IntakeExtraction } from '@neighborline/core';

export type ExtraKey = 'payout_line' | 'ask_category' | 'ask_location' | 'ask_again';
export type QuestionKey = 'ask_payout' | 'ask_household' | 'ask_category' | 'ask_location' | 'ask_again';

/** Slots: {wallet} {receiver}. */
const EXTRA: Readonly<Record<CatalogLang, Readonly<Record<ExtraKey, string>>>> = {
  en: {
    payout_line: 'If approved, the money goes to your {wallet}: {receiver}.',
    ask_category: 'Could you tell me a little more about what you need help with?',
    ask_location: 'What neighborhood or street do you live on?',
    ask_again: 'Sorry, I want to be sure I understood. Could you tell me again what you need?',
  },
  es: {
    payout_line: 'Si se aprueba, el dinero irá a su {wallet}: {receiver}.',
    ask_category: '¿Me puede contar un poco más sobre qué tipo de ayuda necesita?',
    ask_location: '¿En qué barrio o calle vive?',
    ask_again: 'Perdón, quiero asegurarme de haber entendido. ¿Me puede decir otra vez qué necesita?',
  },
  vi: {
    payout_line: 'Nếu được duyệt, tiền sẽ được gửi vào {wallet} của bạn: {receiver}.',
    ask_category: 'Bạn có thể nói rõ hơn một chút là bạn cần giúp gì không?',
    ask_location: 'Bạn sống ở khu phố hoặc con đường nào?',
    ask_again: 'Xin lỗi, chúng tôi muốn chắc là đã hiểu đúng. Bạn có thể nói lại bạn cần gì không?',
  },
  ht: {
    payout_line: 'Si yo apwouve l, lajan an ap ale sou {wallet} ou: {receiver}.',
    ask_category: 'Èske w ka di nou yon ti kras plis sou ki èd ou bezwen?',
    ask_location: 'Nan ki katye oswa nan ki lari ou rete?',
    ask_again: 'Eskize nou, nou vle sèten nou byen konprann. Èske w ka di nou ankò kisa w bezwen?',
  },
  zh: {
    payout_line: '如获批准，钱将汇到您的 {wallet}：{receiver}。',
    ask_category: '能再多告诉我们一些您需要什么帮助吗？',
    ask_location: '您住在哪个街区或哪条街？',
    ask_again: '抱歉，我们想确认没有理解错。您能再说一遍需要什么帮助吗？',
  },
  ar: {
    payout_line: 'إذا تمت الموافقة، سيُرسَل المال إلى حسابك في {wallet}: {receiver}.',
    ask_category: 'هل يمكنك أن تخبرنا أكثر قليلًا عن نوع المساعدة التي تحتاجها؟',
    ask_location: 'في أي حي أو شارع تسكن؟',
    ask_again: 'عذرًا، نريد أن نتأكد أننا فهمنا جيدًا. هل يمكنك أن تخبرنا مرة أخرى بما تحتاجه؟',
  },
};

const catalogLang = (lang: string): CatalogLang => (isCatalogLang(lang) ? lang : 'en');

export function extra(key: ExtraKey, lang: string, vars: Record<string, string> = {}): string {
  return EXTRA[catalogLang(lang)][key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export const walletLabel = (wallet: 'PAYPAL' | 'VENMO'): string => (wallet === 'VENMO' ? 'Venmo' : 'PayPal');

/** "Here is what I understood. Please tell me if it is right: <summary> If approved, … <receiver>." */
export function composeReadBack(extraction: Pick<IntakeExtraction, 'summaryNative' | 'payout'>, lang: string): string {
  const parts = [render('readback_intro', lang), extraction.summaryNative.trim()];
  if (extraction.payout) {
    parts.push(extra('payout_line', lang, { wallet: walletLabel(extraction.payout.wallet), receiver: extraction.payout.value }));
  }
  return parts.join(' ');
}

const ORDER: ReadonlyArray<IntakeExtraction['missing'][number]> = ['payout', 'category', 'household', 'location'];

/** The single most important question to ask, or null. */
export function pickQuestion(missing: IntakeExtraction['missing'], lowConfidence: boolean): QuestionKey | null {
  if (lowConfidence) return 'ask_again';
  const first = ORDER.find((m) => missing.includes(m));
  return first ? (`ask_${first}` as QuestionKey) : null;
}

export function questionText(key: QuestionKey, lang: string): string {
  return key === 'ask_payout' || key === 'ask_household' ? render(key, lang) : extra(key, lang);
}
