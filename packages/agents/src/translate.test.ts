import { describe, expect, it } from 'vitest';
import { ScriptedLLM } from './providers/fixture-llm.js';
import { createFixtureLLM } from './fixtures/responders.js';
import { noteFacts, translateWithCheck } from './translate.js';

describe('noteFacts', () => {
  it('keeps amounts, emails, handles, links, phones and numbers, each once', () => {
    expect(noteFacts('Send the receipt to organizers@eastside-mutualaid.org by Friday, up to $45.50.')).toEqual([
      'organizers@eastside-mutualaid.org',
      '$45.50',
    ]);
    expect(noteFacts('Call +1 (617) 555-0142 or Venmo @dana-ortiz; see https://example.org/help.')).toEqual([
      'https://example.org/help',
      '@dana-ortiz',
      '+1 (617) 555-0142',
    ]);
    expect(noteFacts('We pay rent help after the 15th, for 2 people max.')).toEqual(['2']); // an ordinal ("15th") is not kept verbatim: "15e", "ngày 15" are right too
    expect(noteFacts('Sorry, we could not approve it this time.')).toEqual([]);
  });
});

describe('translateWithCheck on an organizer note', () => {
  const note = 'Please send a photo of the bill to organizers@eastside-mutualaid.org and we will look again.';

  it('fixture mode (no model): nothing is translated, the caller sends the original with a template line', async () => {
    const r = await translateWithCheck(createFixtureLLM(), { text: note, targetLang: 'vi', facts: noteFacts(note) });
    expect(r.translated).toBe(false);
    expect(r.text).toBe(note);
  });

  it('a translation that keeps every fact and back-translates cleanly is used', async () => {
    const vi = 'Xin gửi ảnh hóa đơn tới organizers@eastside-mutualaid.org và chúng tôi sẽ xem lại.';
    const llm = new ScriptedLLM([{ translation: vi }, { english: 'Please send a photo of the bill to organizers@eastside-mutualaid.org and we will review again.' }].map((o) => JSON.stringify(o)));
    const r = await translateWithCheck(llm, { text: note, targetLang: 'vi', facts: noteFacts(note) });
    expect(r).toMatchObject({ ok: true, translated: true, text: vi });
  });

  it('a translation that drops or changes a fact is refused (original kept)', async () => {
    const bad = 'Xin gửi ảnh hóa đơn cho chúng tôi.';
    const llm = new ScriptedLLM([{ translation: bad }, { translation: bad }, { english: 'Please send us a photo of the bill.' }].map((o) => JSON.stringify(o)));
    const r = await translateWithCheck(llm, { text: note, targetLang: 'vi', facts: noteFacts(note) });
    expect(r.translated).toBe(false);
    expect(r.text).toBe(note);
  });
});
