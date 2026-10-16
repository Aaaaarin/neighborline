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
