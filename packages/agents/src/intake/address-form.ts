/**
 * How to address a Vietnamese-speaking neighbor (core AddressForm), from their own words only:
 *  1. how they introduce themselves: "tôi là bà Lan", "em là Hoa", "Bác tên là Tư";
 *  2. failing that, thanking or greeting the volunteers as "các cháu" / "mấy con" marks an elder whose
 *     form they did not say: "bác" (respectful, gender-neutral).
 * Never from words about someone else ("ông nhà tôi" is her husband), never from a guess about age or
 * gender. Anything else → undefined, and the replies use the neutral "bạn". Pure.
 */
import { VI_ADDRESS_FORMS, type AddressForm } from '@neighborline/core';

const FORMS = VI_ADDRESS_FORMS.filter((f) => f !== 'bạn');
const ALT = FORMS.join('|');
const cap = (f: string): string => f[0]!.toLocaleUpperCase('vi') + f.slice(1);
/** Both cases, for the one pattern that must stay case-sensitive (it checks a capitalised name). */
const ALT_BOTH = [...FORMS, ...FORMS.map(cap)].join('|');
/** Whole Vietnamese words: \b is ASCII-only ("thoại" contains "ạ"). */
const W = (s: string) => `(?<!\\p{L})(?:${s})(?!\\p{L})`;

const SELF_INTRO = [
  // "tôi là bà Lan", "mình là chị Mai", "tui là ông Sáu"
  new RegExp(`${W('tôi|mình|tui|tớ')}\\s+(?:là|tên là)\\s+(${ALT})(?!\\p{L})`, 'iu'),
  // "Bà tên là Lan", "Em tên Hoa", "Xin chào, bác là Tư đây" (a capitalised name must follow; no i flag,
  // because /iu would let \p{Lu} match lowercase letters too)
  new RegExp(`(?:^|[.!?,;:]\\s*)(?:(?:[Xx]in\\s+)?[Cc]hào(?:\\s+(?:các\\s+)?(?:cháu|con|anh|chị|em|bạn))?\\s*,?\\s*)?(${ALT_BOTH})\\s+(?:tên là|tên|là)\\s+\\p{Lu}`, 'u'),
];
/**
 * Speaking TO the volunteers as juniors: "cảm ơn các cháu", "chào mấy con", "các cháu ơi". Not a bare
 * "hai con" / "các cháu" (her own children or grandchildren: "tôi với hai con").
 */
const CALLS_VOLUNTEERS_JUNIOR = new RegExp(
  `${W('cảm ơn|cám ơn|chào|nhờ')}\\s+(?:(?:các|mấy)\\s+)?${W('cháu|con')}|${W('các|mấy')}\\s+${W('cháu|con')}\\s+ơi(?!\\p{L})`,
  'iu',
);

/** The form the person used for themselves, or "bác" for an elder who calls the volunteers cháu/con. */
export function detectAddressForm(text: string): AddressForm | undefined {
  const t = text.normalize('NFC');
  for (const re of SELF_INTRO) {
    const m = re.exec(t);
    if (m?.[1]) return m[1].toLocaleLowerCase('vi') as AddressForm;
  }
  if (CALLS_VOLUNTEERS_JUNIOR.test(t)) return 'bác';
  return undefined;
}

/** Is a form the model gave backed by the words? ('bạn' is the neutral default and always fine.) */
export function isGroundedAddressForm(form: AddressForm, text: string): boolean {
  if (form === 'bạn') return true;
  const t = text.normalize('NFC');
  if (form === 'bác' && CALLS_VOLUNTEERS_JUNIOR.test(t)) return true;
  return new RegExp(W(form), 'iu').test(t);
}
