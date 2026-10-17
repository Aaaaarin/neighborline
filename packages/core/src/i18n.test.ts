import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  CATALOG_LANGS,
  MESSAGE_KEYS,
  MissingTemplateVarError,
  render,
  requiredSlots,
  resolveLang,
  textDirection,
  walletName,
} from './i18n.js';
import { LANGS } from './schemas.js';
import { RAIL_REFUSED_NOTICE } from './rail-notice.js';

const ALL = { amount: '$150', wallet: 'Venmo', name: 'Lan' };

describe('catalog completeness', () => {
  it('has every key in every language, non-empty', () => {
    for (const lang of CATALOG_LANGS) {
      expect(Object.keys(CATALOG[lang]).sort()).toEqual([...MESSAGE_KEYS].sort());
      for (const k of MESSAGE_KEYS) expect(CATALOG[lang][k].trim().length).toBeGreaterThan(0);
    }
  });
  it('uses the same required slots as English in every language (no lost amounts)', () => {
    for (const k of MESSAGE_KEYS) {
      const en = new Set(requiredSlots(CATALOG.en[k]));
      for (const lang of CATALOG_LANGS) expect(new Set(requiredSlots(CATALOG[lang][k]))).toEqual(en);
    }
  });
  it('only uses known slots and balanced optional segments', () => {
    for (const lang of CATALOG_LANGS) {
      for (const k of MESSAGE_KEYS) {
        const t = CATALOG[lang][k];
        for (const m of t.matchAll(/\{(\w+)\}/g)) expect(['amount', 'wallet', 'name']).toContain(m[1]);
        expect(t.split('[[').length).toBe(t.split(']]').length);
      }
    }
  });
  it('mentions the amount in every money message', () => {
    for (const k of ['approved_sending', 'paid', 'unclaimed_help'] as const) {
      for (const lang of CATALOG_LANGS) expect(render(k, lang, ALL)).toContain('$150');
    }
  });
  it('keeps messages short enough for one SMS-ish screen', () => {
    for (const lang of CATALOG_LANGS) for (const k of MESSAGE_KEYS) expect(render(k, lang, ALL).length).toBeLessThan(320);
  });
});

describe('render', () => {
  it('renders the hero-story Vietnamese paid message', () => {
    expect(render('paid', 'vi', { amount: '$150', wallet: 'Venmo' })).toBe(
      'Đã gửi $150 vào Venmo của bạn. Mong số tiền này giúp được bạn. Bạn giữ gìn sức khỏe nhé.',
    );
  });
  it('includes the optional greeting when a name is given', () => {
    expect(render('paid', 'en', ALL)).toBe('Hi Lan. $150 has been sent to your Venmo. We hope it helps. Take care.');
    expect(render('paid', 'zh', ALL).startsWith('Lan，您好。')).toBe(true);
    expect(render('needs_info', 'es', { name: 'Ana' })).toMatch(/^Hola, Ana\. Una persona del grupo/);
  });
  it('Spanish catalog messages assume no gender for the neighbor or the volunteer', () => {
    for (const k of MESSAGE_KEYS) expect(CATALOG.es[k]).not.toMatch(/\b(un voluntario|una voluntaria|organizadora|ayudarla|la llamemos|la espera)\b/i);
  });
  it('drops the greeting when the name is missing or blank', () => {
    expect(render('needs_info', 'en')).toBe('A volunteer has a quick question about your request. Please reply here when you can.');
    expect(render('needs_info', 'ht', { name: '  ' })).toMatch(/^Yon volontè/);
  });
  it('renders Spanish unclaimed help with wallet twice', () => {
    const s = render('unclaimed_help', 'es', { amount: '$100', wallet: 'PayPal' });
    expect(s.match(/PayPal/g)).toHaveLength(2);
    expect(s).not.toMatch(/[{}]/);
  });
  it('trims slot values', () => {
    expect(render('approved_sending', 'en', { amount: ' $60 ', wallet: ' PayPal ' })).toContain('sending $60 to your PayPal now');
  });
  it('throws when a required slot is missing', () => {
    expect(() => render('paid', 'en', { wallet: 'Venmo' })).toThrow(MissingTemplateVarError);
    expect(() => render('paid', 'vi', { amount: '$1' })).toThrow("template 'paid' (vi) needs {wallet}");
  });
  it('falls back to English for languages without a catalog and normalizes tags', () => {
    expect(render('ask_household', 'pt')).toBe(CATALOG.en.ask_household);
    expect(render('ask_household', 'es-MX')).toBe(CATALOG.es.ask_household);
    expect(resolveLang('ZH_cn')).toBe('zh');
    expect(resolveLang('pt-BR')).toBe('en');
  });
  it('has a vetted table for every intake language (no English fallback for fr, tl, ko, ru)', () => {
    expect([...CATALOG_LANGS].sort()).toEqual([...LANGS].sort());
    for (const lang of ['fr', 'tl', 'ko', 'ru'] as const) {
      expect(resolveLang(lang)).toBe(lang);
      for (const k of MESSAGE_KEYS) expect(render(k, lang, ALL)).not.toBe(render(k, 'en', ALL));
    }
    expect(render('paid', 'ko', ALL)).toBe('Lan 님, 안녕하세요. Venmo로 $150를 보내 드렸어요. 도움이 되길 바랍니다. 건강 조심하세요.');
  });
  it('never leaves placeholders in any rendered message', () => {
    for (const lang of CATALOG_LANGS) {
      for (const k of MESSAGE_KEYS) expect(render(k, lang, ALL)).not.toMatch(/[{}[\]]/);
    }
  });
});

describe('payout_rail_refused', () => {
  it('is the same vetted notice the engine sends (rail-notice.ts), with no slots', () => {
    for (const lang of CATALOG_LANGS) {
      expect(render('payout_rail_refused', lang)).toBe(RAIL_REFUSED_NOTICE[lang]);
      expect(requiredSlots(CATALOG[lang].payout_rail_refused)).toEqual([]);
    }
  });
});

describe('helpers', () => {
  it('knows Arabic is RTL', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('vi')).toBe('ltr');
  });
  it('names wallets', () => {
    expect(walletName('VENMO')).toBe('Venmo');
    expect(walletName('PAYPAL')).toBe('PayPal');
  });
});
