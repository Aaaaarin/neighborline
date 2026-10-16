/**
 * Offline extractor used by the fixture provider when a request does not match a scenario
 * (e.g. someone types their own request in the demo with no API keys). Transparent keyword
 * rules; deliberately conservative: never extracts an amount, low confidence when unsure.
 */
import type { IntakeExtraction } from '@neighborline/core';
import { detectLang, wordsRe } from '../lang.js';
import { detectPayout, fold } from './spoken-handles.js';

const CATEGORY_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['medicine_copay', ['medicine', 'insulin', 'pharmacy', 'prescription', 'copay', 'co-pay', 'medicina', 'medicamento', 'farmacia', 'receta', 'thuoc', 'nha thuoc', 'medikaman', 'famasi', 'ensilin', 'kopeman']],
  ['rent_gap', ['rent', 'landlord', 'eviction', 'renta', 'alquiler', 'desalojo', 'tien nha', 'thue nha', 'lwaye']],
  ['transport', ['ride', 'bus', 'gas money', 'transport', 'car', 'transporte', 'pasaje', 'gasolina', 'xe', 'di lai', 'transpo', 'machin']],
  ['utility_outage', ['power', 'electricity', 'heat', 'heater', 'outage', 'utility', 'luz', 'electricidad', 'calefaccion', 'mat dien', 'dien', 'may suoi', 'kouran', 'limye', 'chofaj']],
  ['groceries', ['food', 'groceries', 'grocery', 'comida', 'alimentos', 'despensa', 'do an', 'thuc pham', 'manje']],
];
const TODAY = wordsRe(['today', 'now', 'right now', 'tonight', 'hoy', 'ahora', 'hom nay', 'ngay', 'jodi a', 'kounye a', 'aujourd\'hui']);
const HOUSEHOLD = [
  /(?:household of|family of|we are|there are|somos|nha co|nou se)\s+(\d{1,2})/,
  /(\d{1,2})\s+(?:people|of us|personas|nguoi|moun)/,
];

export function heuristicExtract(text: string, categoryKeys: readonly string[], langHint?: string): IntakeExtraction & { englishText: string } {
  const f = fold(text);
  const lang = (langHint ?? detectLang(text)) as IntakeExtraction['lang'];
  const allowed = new Set(categoryKeys);
  const hit = CATEGORY_WORDS.find(([key, words]) => allowed.has(key) && wordsRe(words).test(f));
  const category = hit?.[0] ?? 'other';
  let householdSize: number | undefined;
  for (const re of HOUSEHOLD) {
    const n = Number(re.exec(f)?.[1]);
    if (n >= 1 && n <= 30) {
      householdSize = n;
      break;
    }
  }
  const payout = detectPayout(text);
  const missing: IntakeExtraction['missing'] = [];
  if (!payout) missing.push('payout');
  if (!hit) missing.push('category');
  if (householdSize === undefined) missing.push('household');
  const short = text.replace(/\s+/g, ' ').trim().slice(0, 280);
  return {
    lang: ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'].includes(lang) ? lang : 'en',
    summaryEn: lang === 'en' ? short : `(offline mode, not translated) ${short}`.slice(0, 600),
    summaryNative: short,
    category,
    ...(householdSize !== undefined ? { householdSize } : {}),
    urgency: TODAY.test(f) ? 'today' : 'this_week',
    requestedItems: hit ? [hit[0].replace(/_/g, ' ')] : [],
    ...(payout ? { payout: { wallet: payout.wallet, type: payout.type, value: payout.value } } : {}),
    missing,
    confidence: hit && payout ? 0.7 : 0.5,
    englishText: text,
  };
}
