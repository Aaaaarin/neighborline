import { describe, expect, it } from 'vitest';
import type { DeclineReasonCode } from '../../types';
import * as tpl from './templates';

const ARABIC = /[؀-ۿ]/;
const slots = { amount: '$150', wallet: 'VENMO' as const, receiver: '@samira-haddad', tx: '7TX123' };

describe('message templates in Arabic', () => {
  it('every neighbor-facing template has an Arabic version (none fall back to English)', () => {
    const texts = [
      tpl.ack('ar').text,
      tpl.sending('ar').text,
      tpl.needsPayout('ar').text,
      tpl.paid('ar', slots).text,
      tpl.claimHelp('ar', slots).text,
      tpl.claimed('ar', slots).text,
      tpl.blockedReply('ar').text,
      tpl.genericReadback('ar', { summary: 'انقطعت الكهرباء', categoryLabel: 'انقطاع الخدمات', cap: '$150', payout: '@samira-haddad' }).text,
      tpl.quickReplies('ar').yes,
    ];
    for (const t of texts) expect(t).toMatch(ARABIC);
  });

  it('declines in Arabic for every reason, keep the organizer note, and keep an English twin', () => {
    for (const code of ['outside_area', 'household_cap', 'needs_info', 'not_covered', 'other'] as DeclineReasonCode[]) {
      const m = tpl.declined('ar', code, 'Please send the receipt');
      expect(m.text).toMatch(ARABIC);
      expect(m.text).toContain('مراجعة');
      expect(m.text).toContain('“Please send the receipt”');
      expect(m.textEn).toMatch(/^We can’t send money this time/);
    }
  });

  it('isolates handles and ids left-to-right inside Arabic text', () => {
    expect(tpl.paid('ar', slots).text).toContain('⁦@samira-haddad⁩');
  });
});

describe('Spanish requester messages assume no gender', () => {
  // Usted throughout, and nothing that agrees with a woman (or a man): "la llamemos", "ayudarla",
  // "la espera", "una organizadora", "bienvenida", "segura" ("Listo:" is the interjection "done").
  const GENDERED = /\b(la|lo) (llamemos|ayudemos|espera|esperamos)\b|\b(ayudarla|ayudarlo|llamarla|llamarlo)\b|\b(organizadora|organizador|voluntaria|voluntario|bienvenid[ao]|segur[ao]|cansad[ao])\b/i;
  it('in every status, claim-help and decline template', () => {
    const texts = [
      tpl.ack('es').text,
      tpl.sending('es').text,
      tpl.needsPayout('es').text,
      tpl.paid('es', slots).text,
      tpl.claimHelp('es', slots).text,
      tpl.claimed('es', slots).text,
      tpl.blockedReply('es').text,
      ...(['outside_area', 'household_cap', 'needs_info', 'not_covered', 'other'] as DeclineReasonCode[]).flatMap((c) => [
        tpl.declined('es', c, 'nota').text,
        tpl.declined('es', c).text,
        tpl.declined('es', c, 'nota', { final: true }).text,
      ]),
    ];
    for (const t of texts) expect(t).not.toMatch(GENDERED);
    expect(tpl.claimHelp('es', slots).text).toContain('¿Quiere que le llamemos');
  });
});

describe('every intake language has its own status and decline texts', () => {
  const LANGS = ['es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'] as const;
  const CODES: DeclineReasonCode[] = ['outside_area', 'household_cap', 'needs_info', 'not_covered', 'other'];
  const all = (lang: (typeof LANGS)[number] | 'en', a = {}) => [
    tpl.ack(lang, a),
    tpl.sending(lang, a),
    tpl.needsPayout(lang, a),
    tpl.paid(lang, slots, a),
    tpl.claimHelp(lang, slots, a),
    tpl.claimed(lang, slots, a),
    tpl.blockedReply(lang, a),
    tpl.genericReadback(lang, { summary: 'x', categoryLabel: 'y', cap: '$150', payout: '@a' }, a),
    ...CODES.flatMap((c) => [tpl.declined(lang, c, undefined, a), tpl.declined(lang, c, undefined, { ...a, final: true })]),
  ];
  it.each(LANGS)('%s: no English fallback, no leftover slots, and the English twin is the same entry', (lang) => {
    const en = all('en');
    all(lang).forEach((m, i) => {
      expect(m.text).not.toBe(en[i]!.text);
      expect(m.text).not.toMatch(/[{}]/);
      expect(m.textEn).toBe(en[i]!.textEn);
    });
    expect(tpl.quickReplies(lang).yes).not.toBe(tpl.quickReplies('en').yes);
  });

  it('Vietnamese elders (bà, ông, cô, chú, bác) are addressed by their form; the volunteers are "chúng cháu"', () => {
    for (const f of ['bà', 'ông', 'cô', 'chú', 'bác'] as const) {
      for (const m of all('vi', { addressForm: f })) {
        expect(m.text).not.toMatch(/(?<!\p{L})bạn(?!\p{L})|chúng tôi|[{}]/iu);
      }
      expect(tpl.paid('vi', slots, { addressForm: f }).text).toBe(
        `Chúng cháu đã gửi $150 vào Venmo của ${f} (@samira-haddad). Mã giao dịch 7TX123. Nếu chưa thấy tiền, ${f} cứ nhắn lại đây ạ.`,
      );
    }
    expect(tpl.ack('vi', { addressForm: 'bà' }).text).toBe('Cảm ơn bà ạ. Hai người trong nhóm đang xem yêu cầu của bà. Thường chỉ mất vài phút — gửi tiền xong là chúng cháu nhắn bà ngay ạ.');
  });

  it('Vietnamese peers (anh, chị, em) are named; the volunteers stay "chúng tôi"; no form → "bạn"', () => {
    for (const f of ['anh', 'chị', 'em'] as const) {
      for (const m of all('vi', { addressForm: f })) expect(m.text).not.toMatch(/(?<!\p{L})bạn(?!\p{L})|chúng cháu|[{}]/iu);
      expect(tpl.claimed('vi', slots, { addressForm: f }).text).toBe(`Xong rồi — $150 đã vào PayPal của ${f}. Cảm ơn ${f} đã kiên nhẫn chờ.`);
    }
    expect(tpl.claimed('vi', slots).text).toBe('Xong rồi — $150 đã vào PayPal của bạn. Cảm ơn bạn đã kiên nhẫn chờ.');
    expect(tpl.claimed('vi', slots, { addressForm: 'bạn' }).text).toBe(tpl.claimed('vi', slots).text);
  });

  it('the address form never changes another language', () => {
    for (const lang of ['es', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'] as const) {
      expect(all(lang, { addressForm: 'bà' }).map((m) => m.text)).toEqual(all(lang).map((m) => m.text));
    }
  });
});
