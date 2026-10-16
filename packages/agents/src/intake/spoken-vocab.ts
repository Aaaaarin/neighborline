/**
 * Per-language vocabulary for payout destinations said aloud: the words for "@", ".", "-" and "_",
 * the filler words people say before a handle ("my Venmo IS…", "c'est LE…", "ang Venmo KO PO AY…"),
 * and the wallet names in the scripts people write them in ("벤모", "فينمو", "Венмо").
 *
 * Written in plain spelling; spoken-handles.ts folds every entry the same way it folds the
 * transcript (lowercase, diacritics stripped, đ→d), so "chấm", "дефис" and "골뱅이" all match.
 * Han-script words (Chinese) are matched without word boundaries because Chinese has no spaces.
 */

export type SymbolChar = '@' | '.' | '-' | '_';

/** Spoken symbols per language. Longer phrases are matched before their prefixes automatically. */
export const SPOKEN_SYMBOLS: Readonly<Record<string, Readonly<Record<SymbolChar, readonly string[]>>>> = {
  en: { '@': ['at sign', 'at'], '.': ['dot', 'period'], '-': ['dash', 'hyphen'], _: ['underscore', 'under score'] },
  es: { '@': ['arroba'], '.': ['punto'], '-': ['guion', 'guion medio'], _: ['guion bajo', 'barra baja'] },
  pt: { '@': ['arroba'], '.': ['ponto'], '-': ['hífen', 'traço'], _: ['sublinhado', 'underline'] },
  fr: { '@': ['arobase', 'arobas'], '.': ['point'], '-': ['tiret', "trait d'union"], _: ['tiret bas', 'tiret du bas', 'underscore'] },
  ht: { '@': ['arobaz'], '.': ['pwen'], '-': ['tire'], _: ['tire anba', 'soulinye'] },
  vi: { '@': ['a còng', 'a móc'], '.': ['chấm'], '-': ['gạch ngang', 'gạch nối'], _: ['gạch dưới'] },
  tl: { '@': [], '.': ['tuldok'], '-': ['gitling'], _: ['salungguhit'] },
  ru: { '@': ['собака', 'собачка'], '.': ['точка'], '-': ['дефис', 'тире'], _: ['нижнее подчёркивание', 'подчёркивание'] },
  zh: { '@': ['艾特', '圈a'], '.': ['点'], '-': ['横杠', '中划线', '短横线', '杠'], _: ['下划线', '底线'] },
  ko: { '@': ['골뱅이', '앳'], '.': ['점', '닷'], '-': ['하이픈', '대시'], _: ['언더바', '언더스코어', '밑줄'] },
  ar: { '@': ['آت'], '.': ['نقطة'], '-': ['شرطة'], _: ['شرطة سفلية'] },
};

/**
 * Words people say before the destination itself. Only LEADING fillers are dropped, so a handle
 * that contains one ("@la-casa") is untouched. Words in non-Latin scripts never reach the handle
 * (only Latin letters and digits can be in one), so ru/zh/ko/ar need no entries.
 */
export const FILLERS: Readonly<Record<string, readonly string[]>> = {
  wallet: ['venmo', 'paypal', 'zelle', 'phone', 'number', 'telefono', 'numero', 'so', 'dien', 'thoai', 'nimewo', 'telefon', 'telephone'],
  en: ['is', "it's", 'its', 'my', 'username', 'user', 'name', 'handle', 'account', 'email', 'e-mail', 'address', 'the', 'under', 'to', 'it', 'me', 'send', 'that', 'on', 'here'],
  es: ['es', 'mi', 'de', 'del', 'usuario', 'correo', 'cuenta', 'el', 'la', 'se', 'llama', 'nombre', 'electronico', 'e', 'su', 'a', 'al'],
  pt: ['meu', 'minha', 'e', 'o', 'a'],
  vi: ['cua', 'toi', 'la', 'ten', 'tai', 'khoan', 'nguoi', 'dung', 'vao', 'dia', 'chi'],
  ht: ['mwen', 'non', 'kont', 'imel', 'se', 'li', 'sou', 'nan'],
  fr: ["c'est", 'est', 'mon', 'ma', 'mes', 'le', 'la', "l'", 'de', 'du', 'sur', 'voici', 'adresse', "d'utilisateur", 'utilisateur', 'courriel', 'mail', 'numero', 'telephone'],
  tl: ['ko', 'po', 'ay', 'ang', 'aking', 'akin', 'si', 'yung', 'iyong', 'ito', 'nito', 'sa', 'ng', 'ni', 'naman', 'lang', 'ho'],
};

/** Words that end a spoken destination ("… and thank you", "… por favor"). */
export const STOPS: readonly string[] = [
  'thank', 'thanks', 'please', 'and', 'but', 'gracias', 'por', 'favor', 'y', 'pero', 'cam', 'xin', 'va', 'mesi', 'merci', 'epi', 'ak', 'et', 'obrigado', 'obrigada', 'salamat',
];

/** Wallet names as people write them, in every script we serve. */
export const WALLET_NAMES: Readonly<Record<'VENMO' | 'PAYPAL' | 'EMAIL', readonly string[]>> = {
  VENMO: ['venmo', 'ven mo', 'венмо', 'венмо́', 'فينمو', 'فنمو', '벤모'],
  PAYPAL: ['paypal', 'pay pal', 'пейпал', 'пэйпал', 'باي بال', 'بايبال', '페이팔', '贝宝'],
  EMAIL: ['email', 'e-mail', 'correo electronico', 'correo', 'imel', 'courriel', 'почта', 'почту', 'имейл', '邮箱', '电子邮件', '이메일', 'البريد الالكتروني', 'ايميل'],
};

export const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
};
