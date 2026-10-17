/**
 * Offline extractor used by the fixture provider when a request does not match a scenario
 * (e.g. someone types their own request in the demo with no API keys). Transparent keyword
 * rules; deliberately conservative: never extracts an amount.
 *
 * Space-delimited languages match whole words on folded text (diacritics stripped). Chinese, Korean
 * and Arabic attach particles and prefixes to words (电/停电了, 전기가, الكهرباء), so they match stems
 * as substrings instead. The category labels the /call quick answers send (policy labels per language)
 * are covered here, so a neighbor who taps one always gets a category.
 */
import type { IntakeExtraction } from '@neighborline/core';
import { detectLang, wordsRe } from '../lang.js';
import { detectAddressForm } from './address-form.js';
import { householdFromFolded } from './household.js';
import { detectPayout, fold } from './spoken-handles.js';

/** Arabic-Indic and full-width digits → ASCII, so "٣ أشخاص" and "３人" count. */
const asciiDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));

/** fold() for matching: also NFC-recompose Hangul (NFKD splits syllables into jamo). */
const matchable = (s: string): string => asciiDigits(fold(s)).normalize('NFC');

/** wordsRe is global (stateful .test); these are reused, so drop the g flag. */
const wordRe = (words: readonly string[]): RegExp => new RegExp(wordsRe(words).source, 'iu');

/**
 * `need`: words that name the need itself (heat, rent, medicine). `context`: words that often come
 * with it but name who or what is involved (the landlord). A request is scored by how many distinct
 * need words (weight 2) and context words (weight 1) it uses, so "the heating broke and the landlord
 * won't fix it" is a utility outage, not rent, while "the landlord gave me until the 5th" is rent.
 */
type Terms = { words: readonly string[]; stems: readonly string[] };
type Rule = { need: Terms; context?: Terms };

const CATEGORY_RULES: ReadonlyArray<readonly [string, Rule]> = [
  [
    'medicine_copay',
    {
      need: {
        words: [
          'medicine', 'meds', 'insulin', 'inhaler', 'pharmacy', 'prescription', 'copay', 'co-pay', 'pills', 'antibiotics?',
          'medicina', 'medicinas', 'medicamentos?', 'farmacia', 'receta', 'copago', 'inhalador', 'insulina', 'antibioticos?',
          'thuoc', 'nha thuoc', 'medikaman', 'famasi', 'ensilin', 'kopeman', 'medicaments?', 'pharmacie', 'insuline', 'ordonnance', 'inhalateur',
          'gamot', 'botika', 'лекарств\\p{L}*', 'аптек\\p{L}*', 'инсулин\\p{L}*', 'рецепт\\p{L}*', 'ингалятор\\p{L}*',
        ],
        stems: ['药', '胰岛素', '吸入器', '약국', '약값', '약을', '약이', '인슐린', '처방', '흡입기', 'دواء', 'ادوية', 'صيدلية', 'انسولين', 'بخاخ'],
      },
    },
  ],
  [
    'rent_gap',
    {
      need: {
        words: ['rent', 'eviction', 'evicted', 'renta', 'alquiler', 'desalojo', 'tien nha', 'thue nha', 'lwaye', 'loyer', 'expulsion', 'upa', 'аренд\\p{L}*', 'квартплат\\p{L}*'],
        stems: ['房租', '租金', '월세', '집세', '임대료', 'ايجار'],
      },
      context: {
        words: ['landlord', 'landlady', 'casero', 'casera', 'dueno', 'chu nha', 'met kay', 'proprietaire', 'kasero', 'may-ari', 'хозя\\p{L}*', 'арендодател\\p{L}*'],
        stems: ['房东', '집주인', 'المالك', 'صاحب البيت', 'صاحب الشقة'],
      },
    },
  ],
  [
    'transport',
    {
      need: {
        words: ['ride', 'bus', 'bus pass', 'gas money', 'transport', 'car', 'transporte', 'pasaje', 'gasolina', 'xe', 'di lai', 'transpo', 'machin', 'bis', 'essence', 'trajet', 'pamasahe', 'sasakyan', 'проезд\\p{L}*', 'транспорт\\p{L}*', 'автобус\\p{L}*', 'бензин\\p{L}*', 'такси'],
        stems: ['车费', '交通', '公交', '油钱', '打车', '교통', '버스', '차비', '기름값', '택시', 'مواصلات', 'بنزين'],
      },
    },
  ],
  [
    'utility_outage',
    {
      need: {
        words: [
          'power', 'electricity', 'heat', 'heating', 'heater', 'furnace', 'boiler', 'outage', 'utility', 'gas bill', 'light bill',
          'luz', 'electricidad', 'calefaccion', 'calentador', 'mat dien', 'dien', 'may suoi', 'lo suoi', 'suoi am',
          'kouran', 'limye', 'chofaj', 'electricite', 'courant', 'chauffage', 'panne', 'kuryente', 'brownout',
          'электричеств\\p{L}*', 'света', 'свет', 'отоплени\\p{L}*', 'обогревател\\p{L}*',
        ],
        stems: ['停电', '没电', '断电', '暖气', '取暖', '供暖', '정전', '전기', '난방', '히터', 'كهرباء', 'انقطاع', 'تدفئة', 'مدفاة', 'سخان'],
      },
    },
  ],
  [
    'groceries',
    {
      need: {
        words: [
          'food', 'groceries', 'grocery', 'hungry', 'hunger', 'meals?', 'nothing to eat', 'fridge is empty',
          'comida', 'alimentos', 'despensa', 'hambre', 'comer', 'do an', 'thuc pham', 'bi doi', 'nhin doi', 'bua an', 'manje', 'grangou',
          'nourriture', 'courses', 'epicerie', 'manger', 'faim', 'repas', 'pagkain', 'bigas', 'gutom', 'makain', 'kumain',
          'еда', 'еды', 'еду', 'продукт\\p{L}*', 'голод\\p{L}*', 'кормить', 'накормить',
        ],
        stems: ['食物', '食品', '买菜', '吃的', '杂货', '粮食', '吃饭', '饿', '음식', '식료품', '장보기', '먹을', '굶', '배고', 'طعام', 'غذائية', 'بقالة', 'جوع', 'جائع', 'جياع'],
      },
    },
  ],
];

/**
 * "Something else": only when a line of the request IS that answer (the /call quick answer), never
 * because "other" appears in a sentence.
 */
const OTHER_ANSWERS = new Set(
  ['other', 'something else', 'otro', 'otra cosa', 'khac', 'lot bagay', 'autre', 'autre chose', 'iba pa', '其他', 'اخرى', '기타', 'другое'].map((s) => matchable(s)),
);

/** Each term as its own matcher, so a score counts distinct terms. */
const termMatchers = (t: Terms | undefined): Array<(f: string) => boolean> => [
  ...(t?.words ?? []).map((w) => {
    const re = wordRe([w]);
    return (f: string) => re.test(f);
  }),
  ...(t?.stems ?? []).map((stem) => {
    const m = matchable(stem);
    return (f: string) => f.includes(m);
  }),
];
const RULE_MATCHERS = CATEGORY_RULES.map(([key, r]) => [key, termMatchers(r.need), termMatchers(r.context)] as const);

const TODAY = wordRe(['today', 'now', 'right now', 'tonight', 'hoy', 'ahora', 'hom nay', 'ngay', 'jodi a', 'kounye a', 'aujourd\'hui', 'ce soir', 'ngayon', 'сегодня', 'сейчас']);
const TODAY_STEMS = ['今天', '现在', '今晚', '오늘', '지금', 'اليوم', 'الان'].map((s) => matchable(s));

export const householdFrom = (text: string): number | undefined => householdFromFolded(matchable(text));

export function categoryFrom(text: string, allowed: ReadonlySet<string>): string | undefined {
  const f = matchable(text);
  let best: { key: string; score: number } | undefined;
  for (const [key, need, context] of RULE_MATCHERS) {
    if (!allowed.has(key)) continue;
    const score = 2 * need.filter((m) => m(f)).length + context.filter((m) => m(f)).length;
    // Ties keep the earlier rule (medicine, rent, transport, utility, groceries).
    if (score > 0 && (!best || score > best.score)) best = { key, score };
  }
  if (best) return best.key;
  if (allowed.has('other') && text.split('\n').some((line) => OTHER_ANSWERS.has(matchable(line).replace(/[.!?。！？]+$/u, '').trim()))) return 'other';
  return undefined;
}

export function heuristicExtract(text: string, categoryKeys: readonly string[], langHint?: string): IntakeExtraction & { englishText: string } {
  const f = matchable(text);
  const lang = (langHint ?? detectLang(text)) as IntakeExtraction['lang'];
  const category = categoryFrom(text, new Set(categoryKeys));
  const householdSize = householdFrom(text);
  const payout = detectPayout(text);
  const missing: IntakeExtraction['missing'] = [];
  if (!payout) missing.push('payout');
  if (!category) missing.push('category');
  if (householdSize === undefined) missing.push('household');
  const short = text.replace(/\s+/g, ' ').trim().slice(0, 280);
  const addressForm = lang === 'vi' ? detectAddressForm(text) : undefined;
  return {
    lang: ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'].includes(lang) ? lang : 'en',
    summaryEn: lang === 'en' ? short : `(offline mode, not translated) ${short}`.slice(0, 600),
    summaryNative: short,
    category: category ?? 'other',
    ...(householdSize !== undefined ? { householdSize } : {}),
    urgency: TODAY.test(f) || TODAY_STEMS.some((s) => f.includes(s)) ? 'today' : 'this_week',
    requestedItems: category ? [category.replace(/_/g, ' ')] : [],
    ...(payout ? { payout: { wallet: payout.wallet, type: payout.type, value: payout.value } } : {}),
    missing,
    // The rules are transparent, so a miss is a missing field, not doubt about the person: at or above
    // LOW_CONFIDENCE the agent asks the one specific question (payout, then category) instead of "say it again".
    confidence: category && payout ? 0.7 : 0.6,
    ...(addressForm ? { addressForm } : {}),
    englishText: text,
  };
}
