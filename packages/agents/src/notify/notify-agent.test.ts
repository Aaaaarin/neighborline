import { describe, expect, it } from 'vitest';
import { createFixtureLLM } from '../fixtures/responders.js';
import { SCENARIOS } from '../fixtures/scenarios.js';
import { ScriptedLLM } from '../providers/fixture-llm.js';
import { FixtureTTS } from '../providers/fixture-audio.js';
import { render } from '@neighborline/core';
import { NOTIFY_KEYS, NotifyAgent, notifyKeyFor, type NotifyKey } from './notify-agent.js';

const notify = new NotifyAgent({ llm: createFixtureLLM(), tts: new FixtureTTS() });
const cents = (amount?: string): number | undefined => (amount ? Number(amount.replace(/[$,]/g, '')) * 100 : undefined);
const wallet = (w?: string): 'PAYPAL' | 'VENMO' | undefined => (w === 'Venmo' ? 'VENMO' : w === 'PayPal' ? 'PAYPAL' : undefined);

describe('NotifyAgent: vetted catalog messages for every scenario', () => {
  const cases = SCENARIOS.flatMap((s) => s.notifications.map((n) => [`${s.id}/${n.key}`, s.lang, n] as const));
  it.each(cases)('%s', async (_name, lang, n) => {
    const amountCents = cents(n.vars.amount);
    const w = wallet(n.vars.wallet);
    const r = await notify.render({
      key: n.key as NotifyKey,
      lang,
      ...(amountCents !== undefined ? { amountCents } : {}),
      ...(w ? { wallet: w } : {}),
      ...(n.vars.name ? { name: n.vars.name } : {}),
    });
    expect(r).toMatchObject({ text: n.text, lang, source: 'catalog' });
    expect(r.traces).toEqual([]); // no model call for catalog languages
  });

  it('the English line under every message is the same key with the same slots', async () => {
    for (const key of NOTIFY_KEYS) {
      for (const lang of ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru', 'pt']) {
        const r = await notify.render({ key, lang, amountCents: 15000, wallet: 'VENMO', name: 'Lan' });
        expect(r.textEn).toBe(render(key, 'en', { amount: '$150', wallet: 'Venmo', name: 'Lan' }));
      }
    }
    const sending = await notify.render({ key: 'approved_sending', lang: 'vi', amountCents: 15000, wallet: 'VENMO' });
    expect(sending.textEn).toBe('Good news: your request was approved. We are sending $150 to your Venmo now.');
  });

  it('hero beat: "Đã gửi $150 vào Venmo của bạn"', async () => {
    const r = await notify.render({ key: 'paid', lang: 'vi', amountCents: 15000, wallet: 'VENMO', speak: true });
    expect(r.text.startsWith('Đã gửi $150 vào Venmo của bạn.')).toBe(true);
    expect(r.audio?.useBrowserSpeech).toBe(true);
  });
});

describe('NotifyAgent: languages outside the catalog', () => {
  it('French is translated and passes the back-translation fact check', async () => {
    const r = await notify.render({ key: 'paid', lang: 'fr', amountCents: 15000, wallet: 'VENMO' });
    expect(r.source).toBe('translated');
    expect(r.lang).toBe('fr');
    expect(r.text).toBe('$150 ont été envoyés sur votre Venmo. Nous espérons que cela vous aidera. Prenez soin de vous.');
    expect(r.check).toEqual({ facts: ['$150', 'Venmo'], missingInTranslation: [], missingInBackTranslation: [], ok: true });
    expect(r.backTranslation).toContain('$150');
  });

  it('a translation that changes the amount is rejected → vetted English is sent instead', async () => {
    const llm = new ScriptedLLM([
      JSON.stringify({ translation: '150 $ ont été envoyés sur votre Venmo.' }), // reformatted amount
      JSON.stringify({ translation: '$1500 ont été envoyés sur votre Venmo.' }), // repair makes it worse
    ]);
    const r = await new NotifyAgent({ llm }).render({ key: 'paid', lang: 'fr', amountCents: 15000, wallet: 'VENMO' });
    expect(r.source).toBe('catalog_en_fallback');
    expect(r.lang).toBe('en');
    expect(r.text).toBe('$150 has been sent to your Venmo. We hope it helps. Take care.');
  });

  it('back-translation that loses the wallet fails the check', async () => {
    const llm = new ScriptedLLM([
      JSON.stringify({ translation: '$150 ont été envoyés sur votre Venmo.' }),
      JSON.stringify({ english: '$150 was sent to your bank account.' }),
    ]);
    const r = await new NotifyAgent({ llm }).render({ key: 'paid', lang: 'fr', amountCents: 15000, wallet: 'VENMO' });
    expect(r.source).toBe('catalog_en_fallback');
    expect(r.check?.missingInBackTranslation).toEqual(['Venmo']);
  });

  it('no fixture translation available → English (never an unchecked guess)', async () => {
    const r = await notify.render({ key: 'paid', lang: 'ko', amountCents: 6000, wallet: 'PAYPAL' });
    expect(r).toMatchObject({ source: 'catalog_en_fallback', lang: 'en', text: '$60 has been sent to your PayPal. We hope it helps. Take care.' });
  });
});

describe('notifyKeyFor', () => {
  it('maps payout item and request states to messages', () => {
    expect(notifyKeyFor({ itemStatus: 'SUCCESS' })).toBe('paid');
    expect(notifyKeyFor({ itemStatus: 'UNCLAIMED' })).toBe('unclaimed_help');
    expect(notifyKeyFor({ requestStatus: 'awaiting_approval' })).toBe('confirmed_waiting');
    expect(notifyKeyFor({ requestStatus: 'declined' })).toBe('declined_with_appeal');
    expect(notifyKeyFor({ requestStatus: 'needs_clarification' })).toBe('needs_info');
    expect(notifyKeyFor({ requestStatus: 'cancelled' })).toBeNull();
  });
});

describe('fact check matching', () => {
  it('matches whole amounts only', async () => {
    const { checkFacts } = await import('../translate.js');
    expect(checkFacts(['$150', 'Venmo'], '$1500 sur Venmo', '$150 to Venmo').missingInTranslation).toEqual(['$150']);
    expect(checkFacts(['$150'], '$150.50', '$150').missingInTranslation).toEqual(['$150']);
    expect(checkFacts(['$150'], 'Envoyé : $150.', '$150.').ok).toBe(true);
  });
});
