/**
 * Read-back framing and clarifying questions. Vetted strings only: the catalog phrases come from
 * core's i18n (readback_intro, ask_payout, ask_household); the few intake-only phrases live here
 * in the same languages (CATALOG_LANGS). The model contributes only `summaryNative`.
 * Vietnamese has elder / peer variants ({you} = bà, ông, chị…), chosen by the extracted address form.
 */
import { addressed, isCatalogLang, render, viRegister, type AddressForm, type CatalogLang, type IntakeExtraction } from '@neighborline/core';

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
  fr: {
    payout_line: 'Si la demande est approuvée, l’argent ira sur votre {wallet} : {receiver}.',
    ask_category: 'Pouvez-vous nous en dire un peu plus sur l’aide dont vous avez besoin ?',
    ask_location: 'Dans quel quartier ou dans quelle rue habitez-vous ?',
    ask_again: 'Excusez-nous, nous voulons être sûrs d’avoir bien compris. Pouvez-vous nous redire ce dont vous avez besoin ?',
  },
  tl: {
    payout_line: 'Kapag naaprubahan, mapupunta ang pera sa iyong {wallet}: {receiver}.',
    ask_category: 'Puwede mo bang ikuwento nang kaunti pa kung anong tulong ang kailangan mo?',
    ask_location: 'Saang lugar o kalye ka nakatira?',
    ask_again: 'Paumanhin, gusto naming makasigurong naintindihan ka namin. Puwede mo bang sabihin ulit kung ano ang kailangan mo?',
  },
  ko: {
    payout_line: '승인되면 {wallet} 계정으로 보내 드려요: {receiver}.',
    ask_category: '어떤 도움이 필요하신지 조금 더 말씀해 주시겠어요?',
    ask_location: '어느 동네나 거리에 사세요?',
    ask_again: '죄송해요, 제대로 이해했는지 확인하고 싶어요. 필요하신 것을 다시 한번 말씀해 주시겠어요?',
  },
  ru: {
    payout_line: 'Если просьбу одобрят, деньги придут на ваш {wallet}: {receiver}.',
    ask_category: 'Расскажите, пожалуйста, чуть подробнее, какая помощь вам нужна.',
    ask_location: 'В каком районе или на какой улице вы живёте?',
    ask_again: 'Извините, мы хотим убедиться, что всё правильно поняли. Скажите, пожалуйста, ещё раз, что вам нужно?',
  },
};

/** Vietnamese for an elder (bà, ông…: "chúng cháu", "ạ") or a peer (anh, chị, em); core address.ts. */
const EXTRA_VI_REGISTERS: { readonly viElder: Readonly<Record<ExtraKey, string>>; readonly viPeer: Readonly<Record<ExtraKey, string>> } = {
  viElder: {
    payout_line: 'Nếu được duyệt, tiền sẽ được gửi vào {wallet} của {you}: {receiver}.',
    ask_category: '{You} kể thêm cho chúng cháu một chút, {you} cần giúp việc gì ạ?',
    ask_location: '{You} sống ở khu phố hay con đường nào ạ?',
    ask_again: 'Xin lỗi {you}, chúng cháu muốn chắc là đã hiểu đúng. {You} nói lại giúp chúng cháu {you} cần gì được không ạ?',
  },
  viPeer: {
    payout_line: 'Nếu được duyệt, tiền sẽ được gửi vào {wallet} của {you}: {receiver}.',
    ask_category: '{You} có thể nói rõ hơn một chút là {you} cần giúp gì không?',
    ask_location: '{You} sống ở khu phố hoặc con đường nào?',
    ask_again: 'Xin lỗi, chúng tôi muốn chắc là đã hiểu đúng. {You} có thể nói lại {you} cần gì không?',
  },
};

const catalogLang = (lang: string): CatalogLang => (isCatalogLang(lang) ? lang : 'en');

function extraTemplate(key: ExtraKey, lang: string, form?: AddressForm | null): string {
  const l = catalogLang(lang);
  const reg = l === 'vi' ? viRegister(form) : 'neutral';
  const t = reg === 'elder' ? EXTRA_VI_REGISTERS.viElder[key] : reg === 'peer' ? EXTRA_VI_REGISTERS.viPeer[key] : EXTRA[l][key];
  return addressed(t, form);
}

export function extra(key: ExtraKey, lang: string, vars: Record<string, string> = {}, form?: AddressForm | null): string {
  return extraTemplate(key, lang, form).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export const walletLabel = (wallet: 'PAYPAL' | 'VENMO'): string => (wallet === 'VENMO' ? 'Venmo' : 'PayPal');

/** "Here is what I understood. Please tell me if it is right: <summary> If approved, … <receiver>." */
export function composeReadBack(extraction: Pick<IntakeExtraction, 'summaryNative' | 'payout' | 'addressForm'>, lang: string): string {
  const form = extraction.addressForm;
  const parts = [render('readback_intro', lang, {}, { addressForm: form }), extraction.summaryNative.trim()];
  if (extraction.payout) {
    parts.push(extra('payout_line', lang, { wallet: walletLabel(extraction.payout.wallet), receiver: extraction.payout.value }, form));
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

export function questionText(key: QuestionKey, lang: string, form?: AddressForm | null): string {
  return key === 'ask_payout' || key === 'ask_household' ? render(key, lang, {}, { addressForm: form }) : extra(key, lang, {}, form);
}
