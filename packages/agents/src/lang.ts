/**
 * Lightweight language identification for transcripts when the STT provider does not report one
 * (gpt-4o-transcribe) and for the offline fixture extractor. Script first, then marker words.
 */

export const LANG_NAMES: Readonly<Record<string, string>> = {
  en: 'English', es: 'Spanish', vi: 'Vietnamese', ht: 'Haitian Creole', zh: 'Chinese', ar: 'Arabic',
  fr: 'French', tl: 'Tagalog', ko: 'Korean', ru: 'Russian', pt: 'Portuguese', so: 'Somali',
};
export const langName = (lang: string): string => LANG_NAMES[primaryLang(lang)] ?? lang;
export const primaryLang = (lang: string): string => lang.toLowerCase().split(/[-_]/)[0] ?? 'en';

const WHISPER_NAMES: Readonly<Record<string, string>> = {
  english: 'en', spanish: 'es', vietnamese: 'vi', haitian: 'ht', 'haitian creole': 'ht', chinese: 'zh',
  mandarin: 'zh', cantonese: 'zh', arabic: 'ar', french: 'fr', tagalog: 'tl', filipino: 'tl', korean: 'ko',
  russian: 'ru', portuguese: 'pt', somali: 'so',
};
/** whisper-1 verbose_json reports e.g. "vietnamese"; some versions report ISO codes. */
export function langFromWhisperName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(n)) return n;
  return WHISPER_NAMES[n];
}

/** Whole-word matcher that also works for accented words (JS `\b` is ASCII-only). */
export const wordsRe = (words: readonly string[]): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

const MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  ['vi', wordsRe(['tôi', 'của', 'không', 'được', 'người', 'nhà', 'cần', 'mất', 'điện', 'cảm ơn', 'và', 'là', 'bạn'])],
  ['ht', wordsRe(['mwen', 'nou', 'bezwen', 'lajan', 'mèsi', 'anpil', 'kounye a', 'lakay', 'pou', 'epi', 'ak', 'yon', 'rele', 'mwen se'])],
  ['es', wordsRe(['hola', 'necesito', 'ayuda', 'para', 'gracias', 'tengo', 'somos', 'mis?', 'el', 'los', 'las', 'que', 'con', 'por favor', 'comida', 'luz'])],
  ['fr', wordsRe(['je', "j'ai", 'besoin', 'merci', 'nous', 'avec', 'pour', 'est', 'électricité', 'bonjour', 'mon', 'les'])],
  ['tl', wordsRe(['ako', 'kailangan', 'salamat', 'po', 'ng', 'mga', 'namin', 'kami', 'sa', 'ang'])],
  ['pt', wordsRe(['eu', 'preciso', 'obrigad[oa]', 'ajuda', 'não', 'minha', 'meu'])],
  ['en', wordsRe(['i', 'my', 'the', 'need', 'help', 'and', 'is', 'we', 'power', 'please', 'thank', 'you', 'food', 'our'])],
];

export function detectLang(text: string, fallback = 'en'): string {
  const t = text.normalize('NFC');
  if (/[가-힯]/.test(t)) return 'ko';
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[Ѐ-ӿ]/.test(t)) return 'ru';
  // Vietnamese-only letters (ơ ư ă đ and stacked tone marks) are decisive.
  if (/[ơưăđƠƯĂĐạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/u.test(t)) return 'vi';
  let best = fallback;
  let bestScore = 0;
  for (const [lang, re] of MARKERS) {
    const score = t.match(re)?.length ?? 0;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}
