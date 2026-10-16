import { describe, expect, it } from 'vitest';
import { createFixtureLLM, ScriptedLLM } from '@neighborline/agents';
import * as tpl from '../fixtures/templates';
import { localizeDeclineNote } from './decline-note';

const ctx = (mode: 'live' | 'fixture', llm: unknown) => ({ agents: { providers: { mode, llm } } }) as never;
const json = (o: unknown) => JSON.stringify(o);

describe('localizeDeclineNote', () => {
  const note = 'Send a photo of the bill to organizers@eastside-mutualaid.org and we will look again.';

  it('English neighbors and empty notes need nothing', async () => {
    expect(await localizeDeclineNote(ctx('fixture', createFixtureLLM()), 'en', note)).toBeUndefined();
    expect(await localizeDeclineNote(ctx('fixture', createFixtureLLM()), 'vi', '  ')).toBeUndefined();
  });

  it('a note already in the neighbor’s language is sent as written', async () => {
    expect(await localizeDeclineNote(ctx('fixture', createFixtureLLM()), 'es', 'Por favor, mande una foto del recibo.')).toMatchObject({ alreadyInLanguage: true });
  });

  it('fixture mode: no translation, the original goes out', async () => {
    expect(await localizeDeclineNote(ctx('fixture', createFixtureLLM()), 'vi', note)).toEqual({ text: note, translated: false });
  });

  it('live: a checked translation is used, and the send reuses what the preview cached', async () => {
    const vi = 'Xin gửi ảnh hóa đơn tới organizers@eastside-mutualaid.org, chúng tôi sẽ xem lại.';
    const llm = new ScriptedLLM([json({ translation: vi }), json({ english: 'Please send a photo of the bill to organizers@eastside-mutualaid.org, we will look again.' })]);
    const c = ctx('live', llm);
    const unique = `${note} Thanks.`;
    expect(await localizeDeclineNote(c, 'vi', unique, { translate: false })).toMatchObject({ pending: true });
    expect(llm.calls).toHaveLength(0);
    const sent = await localizeDeclineNote(c, 'vi', unique);
    expect(sent).toMatchObject({ translated: true, text: vi });
    expect(await localizeDeclineNote(c, 'vi', unique, { translate: false })).toEqual(sent);
    expect(llm.calls).toHaveLength(2);
  });

  it('live: a translation that loses the email fails the check, so the original goes out', async () => {
    const bad = json({ translation: 'Xin gửi ảnh hóa đơn cho chúng tôi.' });
    const r = await localizeDeclineNote(ctx('live', new ScriptedLLM([bad, bad])), 'vi', `${note} Thank you.`);
    expect(r).toEqual({ text: `${note} Thank you.`, translated: false });
  });

  it('live: a provider error never blocks the decline', async () => {
    const r = await localizeDeclineNote(ctx('live', new ScriptedLLM([])), 'ko', `${note} Take care.`);
    expect(r).toEqual({ text: `${note} Take care.`, translated: false });
  });
});

describe('templates.declined with a note', () => {
  const note = 'Bring the shutoff notice on Tuesday.';
  it('translated: the label and the note are in the neighbor’s language; the organizer sees the original and the back-translation', () => {
    const m = tpl.declined('vi', 'needs_info', note, { noteLocal: { text: 'Mang giấy báo cắt điện vào thứ Ba.', translated: true, backTranslation: 'Bring the power cut notice on Tuesday.' } });
    expect(m.text).toContain('Ghi chú của người duyệt (dịch tự động):\n“Mang giấy báo cắt điện vào thứ Ba.”');
    expect(m.text).not.toContain(note);
    expect(m.textEn).toContain(`“${note}”`);
    expect(m.textEn).toMatch(/Sent to them in Vietnamese, translated automatically\. Back-translation: “Bring the power cut notice on Tuesday\.”/);
  });

  it('not translated: the original, after a line in the neighbor’s language, for every intake language', () => {
    for (const lang of ['es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'] as const) {
      const m = tpl.declined(lang, 'needs_info', note, { noteLocal: { text: note, translated: false } });
      expect(m.text).toContain(`“${note}”`);
      expect(m.text).not.toMatch(/Note from the organizer/);
    }
  });

  it('English neighbors get the note as before', () => {
    expect(tpl.declined('en', 'needs_info', note).text.endsWith(`\n\n“${note}”`)).toBe(true);
  });
});
