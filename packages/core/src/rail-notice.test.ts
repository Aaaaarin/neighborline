import { describe, expect, it } from 'vitest';
import { RAIL_REFUSED_NOTICE, railRefusedNotice } from './rail-notice.js';
import { LANGS } from './schemas.js';

describe('railRefusedNotice', () => {
  it('has a native notice for every intake language, each naming PayPal', () => {
    for (const lang of LANGS) {
      const n = railRefusedNotice(lang);
      expect(n.lang).toBe(lang);
      expect(n.text.trim()).not.toBe('');
      expect(n.text).toContain('PayPal');
      expect(n.textEn).toBe(RAIL_REFUSED_NOTICE.en);
      if (lang !== 'en') expect(n.text).not.toBe(RAIL_REFUSED_NOTICE.en);
    }
  });

  it('never states an amount, a slot, or a promise of when', () => {
    for (const lang of LANGS) {
      const t = RAIL_REFUSED_NOTICE[lang];
      expect(t).not.toMatch(/[$€£¥]|\d/);
      expect(t).not.toMatch(/[{}[\]]/);
      expect(t.length).toBeLessThanOrEqual(320);
    }
    expect(RAIL_REFUSED_NOTICE.en).not.toMatch(/today|tomorrow|minutes|hours|soon/i);
  });

  it('falls back to English for an unknown or regional tag, and keeps the region off', () => {
    expect(railRefusedNotice('de').lang).toBe('en');
    expect(railRefusedNotice('es-MX')).toMatchObject({ lang: 'es', text: RAIL_REFUSED_NOTICE.es });
    expect(railRefusedNotice('pt_BR').text).toBe(RAIL_REFUSED_NOTICE.en);
  });

  it('is plain one-line text (it goes into an SMS / WhatsApp thread)', () => {
    for (const lang of LANGS) expect(RAIL_REFUSED_NOTICE[lang]).not.toMatch(/[\n\r\t]/);
  });
});
