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
import { detectPayout, fold } from './spoken-handles.js';

/** Arabic-Indic and full-width digits → ASCII, so "٣ أشخاص" and "３人" count. */
const asciiDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));

/** fold() for matching: also NFC-recompose Hangul (NFKD splits syllables into jamo). */
const matchable = (s: string): string => asciiDigits(fold(s)).normalize('NFC');

/** wordsRe is global (stateful .test); these are reused, so drop the g flag. */
const wordRe = (words: readonly string[]): RegExp => new RegExp(wordsRe(words).source, 'iu');

type Rule = { words: readonly string[]; stems: readonly string[] };

const CATEGORY_RULES: ReadonlyArray<readonly [string, Rule]> = [
  [
    'medicine_copay',
    {
      words: [
        'medicine', 'insulin', 'pharmacy', 'prescription', 'copay', 'co-pay', 'medicina', 'medicinas', 'medicamentos?', 'farmacia', 'receta', 'copago',
        'thuoc', 'nha thuoc', 'medikaman', 'famasi', 'ensilin', 'kopeman', 'medicaments?', 'pharmacie', 'insuline', 'ordonnance', 'gamot', 'botika',
        'лекарств\\p{L}*', 'аптек\\p{L}*', 'инсулин\\p{L}*', 'рецепт\\p{L}*',
      ],
      stems: ['药', '胰岛素', '약국', '약값', '약을', '약이', '인슐린', '처방', 'دواء', 'ادوية', 'صيدلية', 'انسولين'],
    },
  ],
  [
    'rent_gap',
    {
      words: ['rent', 'landlord', 'eviction', 'renta', 'alquiler', 'desalojo', 'tien nha', 'thue nha', 'lwaye', 'loyer', 'proprietaire', 'expulsion', 'upa', 'renta', 'аренд\\p{L}*', 'квартплат\\p{L}*'],
      stems: ['房租', '租金', '房东', '월세', '집세', '임대료', '집주인', 'ايجار'],
    },
  ],
  [
    'transport',
    {
      words: ['ride', 'bus', 'gas money', 'transport', 'car', 'transporte', 'pasaje', 'gasolina', 'xe', 'di lai', 'transpo', 'machin', 'essence', 'trajet', 'pamasahe', 'sasakyan', 'проезд\\p{L}*', 'транспорт\\p{L}*', 'автобус\\p{L}*', 'бензин\\p{L}*', 'такси'],
      stems: ['车费', '交通', '公交', '油钱', '打车', '교통', '버스', '차비', '기름값', '택시', 'مواصلات', 'بنزين'],
    },
  ],
  [
    'utility_outage',
    {
      words: [
        'power', 'electricity', 'heat', 'heater', 'outage', 'utility', 'luz', 'electricidad', 'calefaccion', 'calentador', 'mat dien', 'dien', 'may suoi',
        'kouran', 'limye', 'chofaj', 'electricite', 'courant', 'chauffage', 'panne', 'kuryente', 'brownout',
        'электричеств\\p{L}*', 'света', 'свет', 'отоплени\\p{L}*', 'обогревател\\p{L}*',
      ],
      stems: ['停电', '没电', '断电', '暖气', '取暖', '供暖', '정전', '전기', '난방', '히터', 'كهرباء', 'انقطاع', 'تدفئة', 'مدفاة', 'سخان'],
    },
  ],
  [
    'groceries',
    {
      words: ['food', 'groceries', 'grocery', 'comida', 'alimentos', 'despensa', 'do an', 'thuc pham', 'manje', 'nourriture', 'courses', 'epicerie', 'pagkain', 'bigas', 'еда', 'еды', 'еду', 'продукт\\p{L}*'],
      stems: ['食物', '食品', '买菜', '吃的', '杂货', '粮食', '음식', '식료품', '장보기', '먹을', 'طعام', 'غذائية', 'بقالة'],
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

const RULE_RES = CATEGORY_RULES.map(([key, r]) => [key, wordRe(r.words), r.stems.map((s) => matchable(s))] as const);

const TODAY = wordRe(['today', 'now', 'right now', 'tonight', 'hoy', 'ahora', 'hom nay', 'ngay', 'jodi a', 'kounye a', 'aujourd\'hui', 'ce soir', 'ngayon', 'сегодня', 'сейчас']);
const TODAY_STEMS = ['今天', '现在', '今晚', '오늘', '지금', 'اليوم', 'الان'].map((s) => matchable(s));

/** Small number words people use for a household ("3 người", "三口人", "세 명", "нас трое"). */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
  двое: 2, трое: 3, четверо: 4, пятеро: 5, шестеро: 6, семеро: 7,
};
const NUM = String.raw`(\d{1,2}|[一两二三四五六七八九十]|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)`;
const HOUSEHOLD: readonly RegExp[] = [
  /(?:household of|family of|we are|there are|somos|nha co|nou se|nous sommes|kami ay)\s+(\d{1,2})/u,
  /(\d{1,2})\s*(?:people|persons?|of us|personas|nguoi|moun|personnes|katao|tao)(?![\p{L}])/u,
  new RegExp(`${NUM}\\s*(?:口人|个人|人)`, 'u'),
  new RegExp(`${NUM}\\s*(?:명|식구|사람)`, 'u'),
  /(\d{1,2})\s*(?:اشخاص|افراد|انفار|شخص)/u,
  /(?:نحن|عددنا|اسرة من|عايلة من)\s*(\d{1,2})/u,
  /(\d{1,2})\s*(?:человек|чел)/u,
  /нас\s+(\d{1,2}|двое|трое|четверо|пятеро|шестеро|семеро)/u,
];

export function householdFrom(text: string): number | undefined {
  const f = matchable(text);
  for (const re of HOUSEHOLD) {
    const raw = re.exec(f)?.[1];
    if (!raw) continue;
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (n !== undefined && n >= 1 && n <= 30) return n;
  }
  return undefined;
}

export function categoryFrom(text: string, allowed: ReadonlySet<string>): string | undefined {
  const f = matchable(text);
  const hit = RULE_RES.find(([key, re, stems]) => allowed.has(key) && (re.test(f) || stems.some((s) => f.includes(s))));
  if (hit) return hit[0];
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
    englishText: text,
  };
}
