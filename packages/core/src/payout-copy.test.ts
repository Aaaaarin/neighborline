import { describe, expect, it } from 'vitest';
import {
  batchEmailSubject,
  clampText,
  cleanPayPalText,
  isAsciiText,
  PAYPAL_EMAIL_SUBJECT_MAX,
  PAYPAL_NOTE_MAX_ASCII,
  PAYPAL_NOTE_MAX_NON_ASCII,
  payoutCopy,
  payPalNoteLimit,
} from './payout-copy.js';
import { LANGS } from './schemas.js';

const GROUP = 'Eastside Mutual Aid';

describe('payoutCopy', () => {
  it('has a subject and a note in every intake language, each naming the group', () => {
    for (const lang of LANGS) {
      const c = payoutCopy(lang, GROUP);
      expect(c.lang).toBe(lang);
      expect(c.emailSubject).toContain(GROUP);
      expect(c.note).toContain(GROUP);
      expect(c.note.trim()).not.toBe('');
      expect(c.emailSubject.length).toBeLessThanOrEqual(PAYPAL_EMAIL_SUBJECT_MAX);
      expect(c.note.length).toBeLessThanOrEqual(payPalNoteLimit(c.note));
    }
  });

  it('English is pure ASCII (the always-safe fallback)', () => {
    const c = payoutCopy('en', GROUP);
    expect(isAsciiText(c.note)).toBe(true);
    expect(isAsciiText(c.emailSubject)).toBe(true);
    expect(c.note).toBe('Mutual aid from your neighbors at Eastside Mutual Aid. No need to pay it back.');
  });

  it('is actually translated (not English) for the other languages', () => {
    const en = payoutCopy('en', GROUP).note;
    for (const lang of LANGS.filter((l) => l !== 'en')) expect(payoutCopy(lang, GROUP).note).not.toBe(en);
    expect(payoutCopy('vi', GROUP).note).toMatch(/không cần trả lại/);
    expect(payoutCopy('zh', GROUP).note).toMatch(/不需要归还/);
  });

  it('isolates the group name left-to-right inside Arabic', () => {
    expect(payoutCopy('ar', GROUP).note).toContain(`⁦${GROUP}⁩`);
  });

  it('falls back to English for unknown or regional language tags', () => {
    expect(payoutCopy('de', GROUP).lang).toBe('en');
    expect(payoutCopy('es-MX', GROUP).lang).toBe('es');
  });

  it('a non-ASCII note that would pass 1000 characters falls back to the ASCII English one', () => {
    const long = 'Eastside '.repeat(130); // ~1170 chars: fits 4000 ASCII, not 1000 non-ASCII
    const c = payoutCopy('vi', long);
    expect(c.lang).toBe('en');
    expect(isAsciiText(c.note)).toBe(true);
    expect(c.note.length).toBeLessThanOrEqual(PAYPAL_NOTE_MAX_ASCII);
    expect(c.emailSubject.length).toBeLessThanOrEqual(PAYPAL_EMAIL_SUBJECT_MAX);
  });

  it('a non-ASCII group name keeps every text within the non-ASCII limit', () => {
    const c = payoutCopy('en', '东区互助会'.repeat(400));
    expect(c.note.length).toBeLessThanOrEqual(PAYPAL_NOTE_MAX_NON_ASCII);
    expect(c.emailSubject.length).toBeLessThanOrEqual(PAYPAL_EMAIL_SUBJECT_MAX);
  });

  it('strips control characters and newlines from the group name', () => {
    const c = payoutCopy('en', 'Eastside\r\nBcc: x@example.com\u0000');
    expect(c.emailSubject).not.toMatch(/[\r\n\u0000]/);
  });
});

describe('batchEmailSubject', () => {
  it('uses the shared language when every neighbor in the batch asked in it', () => {
    expect(batchEmailSubject(['es', 'es'], GROUP)).toBe(payoutCopy('es', GROUP).emailSubject);
  });
  it('uses English when the batch mixes languages', () => {
    expect(batchEmailSubject(['es', 'vi'], GROUP)).toBe(payoutCopy('en', GROUP).emailSubject);
    expect(batchEmailSubject([], GROUP)).toBe(payoutCopy('en', GROUP).emailSubject);
  });
});

describe('clampText / cleanPayPalText', () => {
  it('never splits a surrogate pair', () => {
    const s = '😀'.repeat(10);
    const out = clampText(s, 8);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out).toBe('😀😀...');
  });
  it('leaves short text alone', () => {
    expect(clampText('hi', 8)).toBe('hi');
    expect(cleanPayPalText('  a\t b  ')).toBe('a b');
  });
});
