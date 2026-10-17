/**
 * Household size for the offline extractor, from what people actually say: a number ("3 people",
 * "三口人", "нас трое", "Apat po kami"), living alone ("I live alone", "vivo sola", "혼자 살아요"), or
 * who they live with ("me and my husband", "mon mari et moi", "vivo con mis 2 hijos" = 3).
 * Conservative: when nothing matches, the agent asks. Text is matched after fold() + NFC.
 */

/** Number words per language (folded: "bốn" → "bon", "sèt" → "set", اربعة without hamza). */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
  двое: 2, трое: 3, четверо: 4, пятеро: 5, шестеро: 6, семеро: 7, двумя: 2, тремя: 3, четырьмя: 4,
  اثنان: 2, ثلاثة: 3, اربعة: 4, خمسة: 5, ستة: 6, سبعة: 7,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8,
  de: 2, twa: 3, kat: 4, senk: 5, sis: 6, set: 7,
  dalawa: 2, dalawang: 2, tatlo: 3, tatlong: 3, apat: 4, lima: 5, limang: 5, anim: 6, pito: 7, pitong: 7,
  hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7,
};
const LATIN_NUM = 'two|three|four|five|six|seven|eight|nine|ten|dos|tres|cuatro|cinco|seis|siete|ocho|deux|trois|quatre|cinq|sept|huit|de|twa|kat|senk|sis|set|dalawa(?:ng)?|tatlo(?:ng)?|apat|lima(?:ng)?|anim|pito(?:ng)?|hai|ba|bon|nam|sau|bay';
const N = `(\\d{1,2}|${LATIN_NUM})`;
const CJK_NUM = String.raw`(\d{1,2}|[一两二三四五六七八九十]|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)`;
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

/** Explicit counts. The captured group is the household size. */
/** "we are 2 weeks behind", "somos 3 semanas…": a count followed by a unit of time or money is not a household. */
const NOT_PEOPLE = '(?!\\s*(?:weeks?|days?|months?|years?|hours?|minutes?|dollars?|semanas?|dias|meses|anos|horas|jours|semaines|mois|ans|heures|dola|dolares|dollars|tuan|ngay|thang|nam|linggo|araw|buwan|taon|\\$|%))';
const COUNTS: readonly RegExp[] = [
  new RegExp(`${B}(?:household of|family of|we are|we're|there are|somos|nha co|nou se|nous sommes|kami ay)\\s+${N}${E}${NOT_PEOPLE}`, 'u'),
  // Tagalog links a number to its noun with "na" / "-ng": "4 na tao", "Apat po kami", "Limang katao kami".
  new RegExp(`${B}${N}\\s*(?:na\\s+)?(?:people|persons?|of us|personas|nguoi|moun|personnes|katao|tao|(?:lang\\s+)?(?:po\\s+)?kami)${E}`, 'u'),
  // Haitian Creole states the count after "nou" and before where: "Nou 3 nan kay la", "nou kat lakay".
  new RegExp(`${B}nou\\s+${N}\\s+(?:nan kay|lakay|ladan kay|nan fanmi)${E}`, 'u'),
  new RegExp(`${CJK_NUM}\\s*(?:口人|个人|人)`, 'u'),
  new RegExp(`${CJK_NUM}\\s*(?:명|식구|사람)`, 'u'),
  /(\d{1,2})\s*(?:اشخاص|افراد|انفار|شخص)/u,
  /(?:نحن|عددنا|اسرة من|عايلة من)\s*(\d{1,2}|اثنان|ثلاثة|اربعة|خمسة|ستة|سبعة)/u,
  /(\d{1,2})\s*(?:человек|чел)/u,
  /нас\s+(\d{1,2}|двое|трое|четверо|пятеро|шестеро|семеро)/u,
];

/** Living alone, per language. */
const ALONE = new RegExp(
  [
    `${B}(?:i live alone|i'm alone|i am alone|living alone|live by myself|it's just me|it is just me|just me${E})`,
    `${B}(?:vivo sol[oa]|estoy sol[oa]|je vis seule?|j'habite seule?|je suis seule?${E})`,
    `${B}(?:pou kont mwen|song mot minh|o mot minh|mag-?isa(?: lang)?${E})`,
    '(?:живу одна|живу один|одна живу|один живу)',
    '(?:一个人住|独居|我一个人生活|혼자 살|혼자예요|혼자입니다|혼자 지내)',
    '(?:اعيش وحدي|اعيش لوحدي|اسكن وحدي)',
  ].join('|'),
  'u',
);

/** "just the two of us", "nou de sèlman", "nous deux". */
const TWO_OF_US = new RegExp(`${B}(?:just the two of us|the two of us|nosotros dos|nous deux|nou de|kaming dalawa|hai me con|hai vo chong)${E}`, 'u');

const REL_ONE = 'husband|wife|partner|son|daughter|mom|mother|dad|father|grandson|granddaughter|grandma|grandmother|grandpa|grandfather|sister|brother|boyfriend|girlfriend|baby|kid|child|nephew|niece|aunt|uncle';
const REL_MANY = 'sons|daughters|kids|children|grandkids|grandchildren|babies|sisters|brothers';
const ES_ONE = 'esposo|esposa|marido|mujer|hijo|hija|mama|papa|madre|padre|abuela|abuelo|nieto|nieta|hermano|hermana|pareja|bebe|nina|nino';
const ES_MANY = 'hijos|hijas|nietos|nietas|hermanos|hermanas|ninos|ninas';
const FR_ONE = 'mari|femme|fils|fille|mere|pere|grand-mere|grand-pere|frere|soeur|copain|copine|conjoint|conjointe|bebe|petit-fils|petite-fille';
const FR_MANY = 'enfants|filles|fils|petits-enfants|freres|soeurs';

/** Who someone lives with: [pattern, size given the captured count (or 1 when none)]. */
const COMPANIONS: ReadonlyArray<readonly [RegExp, (n: number) => number]> = [
  [new RegExp(`${B}(?:me and my|my (?:${REL_ONE}) and me|i live with my|it's me and my|just me and my|for me and my)\\s+${N}\\s+(?:${REL_MANY})${E}`, 'u'), (n) => n + 1],
  [new RegExp(`${B}(?:me and my|i live with my|it's me and my|just me and my|for me and my)\\s+(?:${REL_ONE})${E}`, 'u'), () => 2],
  [new RegExp(`${B}my (?:${REL_ONE}) and (?:me|i)${E}`, 'u'), () => 2],
  [new RegExp(`${B}(?:vivo con mis|con mis|yo y mis)\\s+${N}\\s+(?:${ES_MANY})${E}`, 'u'), (n) => n + 1],
  [new RegExp(`${B}(?:vivo con mi|yo y mi)\\s+(?:${ES_ONE})${E}|${B}mi (?:${ES_ONE}) y yo${E}`, 'u'), () => 2],
  [new RegExp(`${B}(?:je vis avec mes|avec mes|moi et mes)\\s+${N}\\s+(?:${FR_MANY})${E}`, 'u'), (n) => n + 1],
  [new RegExp(`${B}(?:je vis avec (?:mon|ma)|moi et (?:mon|ma))\\s+(?:${FR_ONE})${E}|${B}(?:mon|ma) (?:${FR_ONE}) et moi${E}`, 'u'), () => 2],
  [new RegExp(`${B}(?:se mwen ak|mwen ak|m ap viv ak)\\s+${N}\\s+pitit${E}`, 'u'), (n) => n + 1],
];

const toNumber = (raw: string): number | undefined => (/^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw]);
const valid = (n: number | undefined): n is number => n !== undefined && n >= 1 && n <= 30;

/** `f` is the request folded for matching (fold + NFC). */
export function householdFromFolded(f: string): number | undefined {
  // The household is at least every count said ("손자 한 명, 두 사람" → 2; "my 3 grandkids, so 4 of us" → 4).
  const counts = COUNTS.flatMap((re) => [...f.matchAll(new RegExp(re.source, 'gu'))].map((m) => toNumber(m[1] ?? ''))).filter(valid);
  if (counts.length) return Math.max(...counts);
  if (ALONE.test(f)) return 1;
  if (TWO_OF_US.test(f)) return 2;
  for (const [re, size] of COMPANIONS) {
    const m = re.exec(f);
    if (!m) continue;
    const n = m[1] ? toNumber(m[1]) : 1;
    if (valid(n) && valid(size(n))) return size(n);
  }
  return undefined;
}
