import { describe, expect, it } from 'vitest';
import { addressed, pickVariant, textFor, viRegister, viSelf } from './address.js';
import { MESSAGE_KEYS, render } from './i18n.js';
import { batchEmailSubject, payoutCopy } from './payout-copy.js';
import { railRefusedNotice } from './rail-notice.js';
import { IntakeExtraction, VI_ADDRESS_FORMS, type AddressForm } from './schemas.js';

const ALL = { amount: '$150', wallet: 'Venmo', name: 'Lan' };
const ELDERS: AddressForm[] = ['bà', 'ông', 'cô', 'chú', 'bác'];
const PEERS: AddressForm[] = ['anh', 'chị', 'em'];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
/** A whole Vietnamese word (\b is ASCII-only: "thoại" would match "ạ"). */
const word = (w: string) => new RegExp(`(?<!\\p{L})${w}(?!\\p{L})`, 'iu');

describe('Vietnamese address forms', () => {
  it('maps every form to a register and the volunteers’ self-reference', () => {
    for (const f of ELDERS) expect([viRegister(f), viSelf(f)]).toEqual(['elder', 'chúng cháu']);
    for (const f of PEERS) expect([viRegister(f), viSelf(f)]).toEqual(['peer', 'chúng tôi']);
    expect([viRegister('bạn'), viSelf('bạn')]).toEqual(['neutral', 'chúng tôi']);
    expect(viRegister(undefined)).toBe('neutral');
    expect(VI_ADDRESS_FORMS).toEqual([...ELDERS, ...PEERS, 'bạn']);
  });

  it('is schema-validated and optional on the extraction', () => {
    const base = { lang: 'vi', summaryEn: 'x', summaryNative: 'x', category: 'other', urgency: 'today', requestedItems: [], missing: [], confidence: 0.9 };
    expect(IntakeExtraction.parse({ ...base, addressForm: 'bà' }).addressForm).toBe('bà');
    expect(IntakeExtraction.parse(base).addressForm).toBeUndefined();
    expect(IntakeExtraction.safeParse({ ...base, addressForm: 'madam' }).success).toBe(false);
  });

  it('Mrs. Lan (bà): greeted by name, the volunteers are "chúng cháu", polite "ạ"', () => {
    const o = { addressForm: 'bà' as const };
    expect(render('paid', 'vi', ALL, o)).toBe(
      'Chào bà Lan ạ. Chúng cháu đã gửi $150 vào Venmo của bà. Mong số tiền này giúp được bà phần nào. Bà giữ gìn sức khỏe nhé ạ.',
    );
    expect(render('paid', 'vi', { amount: '$150', wallet: 'Venmo' }, o)).toMatch(/^Chào bà ạ\. Chúng cháu đã gửi \$150 vào Venmo của bà\./);
    expect(render('approved_sending', 'vi', ALL, o)).toBe('Tin vui ạ: yêu cầu của bà đã được duyệt. Chúng cháu đang gửi $150 vào Venmo của bà.');
    expect(render('readback_intro', 'vi', {}, o)).toBe('Dạ, chúng cháu hiểu như sau. Bà xem giúp chúng cháu có đúng không ạ:');
  });

  it.each(ELDERS)('elder form "%s": every message addresses them by it, never "bạn" or "chúng tôi"', (f) => {
    for (const k of MESSAGE_KEYS) {
      const t = render(k, 'vi', ALL, { addressForm: f });
      expect(t, k).not.toMatch(word('bạn'));
      expect(t, k).not.toMatch(/chúng tôi|[{}[\]]/i);
      expect(t, k).toMatch(word(f));
    }
    expect(render('confirmed_waiting', 'vi', ALL, { addressForm: f })).toContain('chúng cháu');
  });

  it.each(PEERS)('peer form "%s": addressed by it, the volunteers stay "chúng tôi"', (f) => {
    for (const k of MESSAGE_KEYS) {
      const t = render(k, 'vi', ALL, { addressForm: f });
      expect(t, k).not.toMatch(word('bạn'));
      expect(t, k).not.toMatch(word('ạ'));
      expect(t, k).not.toMatch(/chúng cháu|[{}[\]]/i);
      expect(t, k).toMatch(word(f));
    }
    expect(render('paid', 'vi', ALL, { addressForm: f })).toMatch(new RegExp(`^Chào ${f} Lan\\. Đã gửi \\$150 vào Venmo của ${f}\\.`));
  });

  it('"bạn" and no form both give the neutral catalog text', () => {
    for (const k of MESSAGE_KEYS) {
      expect(render(k, 'vi', ALL, { addressForm: 'bạn' })).toBe(render(k, 'vi', ALL));
      expect(render(k, 'vi', ALL, {})).toBe(render(k, 'vi', ALL));
    }
    expect(render('paid', 'vi', { amount: '$150', wallet: 'Venmo' })).toBe('Đã gửi $150 vào Venmo của bạn. Mong số tiền này giúp được bạn. Bạn giữ gìn sức khỏe nhé.');
  });

  it('other languages ignore the form (usted, vous, 您 … are already one polite register)', () => {
    for (const lang of ['en', 'es', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'] as const) {
      for (const k of MESSAGE_KEYS) expect(render(k, lang, ALL, { addressForm: 'bà' })).toBe(render(k, lang, ALL));
    }
  });

  it('the rail notice and the PayPal / Venmo note follow the form too', () => {
    expect(railRefusedNotice('vi', 'ông').text).toMatch(/^Yêu cầu của ông đã được duyệt.*Ông không làm gì sai cả ạ\./);
    expect(railRefusedNotice('vi').text).toContain('Bạn không làm gì sai cả.');
    expect(railRefusedNotice('es', 'bà').text).toBe(railRefusedNotice('es').text);
    expect(payoutCopy('vi', 'Eastside', 'bà').note).toBe('Tiền hỗ trợ từ bà con hàng xóm ở Eastside. Bà không cần trả lại ạ.');
    expect(payoutCopy('vi', 'Eastside', 'chị').note).toBe('Tiền hỗ trợ từ hàng xóm của chị ở Eastside. Chị không cần trả lại.');
    expect(payoutCopy('vi', 'Eastside').note).toBe('Tiền hỗ trợ từ hàng xóm của bạn ở Eastside. Bạn không cần trả lại.');
    expect(batchEmailSubject([{ lang: 'vi', addressForm: 'bà' }], 'Eastside')).toBe('Bà con hàng xóm ở Eastside gửi tiền giúp bà');
    expect(batchEmailSubject([{ lang: 'vi', addressForm: 'bà' }, { lang: 'vi', addressForm: 'anh' }], 'Eastside')).toBe('Hàng xóm ở Eastside đã gửi tiền giúp bạn');
  });

  it('helpers: variant fallback and slot filling', () => {
    const t = { en: 'a', es: 'a', vi: 'n', viElder: 'E {you}. {You}.', ht: 'a', zh: 'a', ar: 'a', fr: 'a', tl: 'a', ko: 'a', ru: 'a' } as const;
    expect(pickVariant(t, 'vi', 'chị')).toBe('n'); // no peer variant → neutral
    expect(textFor(t, 'vi', 'ông')).toBe('E ông. Ông.');
    expect(textFor(t, 'es', 'ông')).toBe('a');
    expect(addressed('{You} ơi', undefined)).toBe('Bạn ơi');
  });
});
