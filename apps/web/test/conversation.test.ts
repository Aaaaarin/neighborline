import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listNotifications } from '@neighborline/db';
import { startHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});
const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;

async function typed(text: string, lang?: 'zh' | 'ar' | 'ko' | 'ru' | 'en') {
  const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_text', ...(lang ? { lang } : {}) });
  await h.engine.submitText(requestId, { text, ...(lang ? { lang } : {}) });
  return requestId;
}

describe('/call conversation: clarifying question → answer → filed', () => {
  it.each([
    ['zh', '我家停电两天了，需要买一个取暖器。我们家有三口人。', '@wang-li88'],
    ['ar', 'انقطعت الكهرباء عن شقتي منذ يومين وأحتاج إلى مدفأة. نحن 4 أشخاص.', '@samira-h7'],
    ['ko', '이틀째 정전이라 난방이 안 돼요. 우리 집은 세 명이에요.', '@kim-minji'],
    ['ru', 'У нас уже два дня нет света, нужен обогреватель. Нас трое.', '@ivan-petrov7'],
  ] as const)('%s typed in fixture mode: asks where to send the money, in that language, then finishes', async (lang, text, handle) => {
    const id = await typed(text);
    let t = (await h.engine.getThread(id))!;
    expect(t.lang).toBe(lang);
    expect(t.status).toBe('needs_clarification');
    expect(t.question?.key).toBe('ask_payout');
    expect(t.question?.text).not.toMatch(/^Where should we send/);
    expect(t.messages.at(-1)).toMatchObject({ kind: 'question', from: 'line', lang });

    await h.engine.submitText(id, { text: `Venmo ${handle}` });
    t = (await h.engine.getThread(id))!;
    expect(t.status).toBe('intake');
    expect(t.awaitingConfirmation).toBe(true);
    expect(t.messages.filter((m) => m.kind === 'readback').at(-1)!.text).toContain(handle);

    const c = await h.engine.confirmIntake(id, { confirmed: true });
    expect(c.status).toBe('awaiting_approval');
    const v = (await h.engine.getRequest(id))!;
    expect(v.request.computed?.ruleKey).toBe('utility_outage');
  });

  it('category quick answers always resolve, and household is an optional question with 1–6 answers', async () => {
    const id = await typed('I need some help please. My Venmo is @quick-answer1');
    let t = (await h.engine.getThread(id))!;
    expect(t.question?.key).toBe('ask_category');
    expect(t.question?.answers.map((a) => a.label)).toContain('Groceries');
    await h.engine.submitText(id, { text: t.question!.answers.find((a) => a.label === 'Other')!.send });
    t = (await h.engine.getThread(id))!;
    expect(t.status).toBe('intake');
    expect(t.question).toMatchObject({ key: 'ask_household', optional: true });
    expect(t.question!.answers).toHaveLength(6);
  });

  it('a voice reply in fixture mode uses a labelled sample answer for the pending question', async () => {
    const id = await typed('我家停电两天了，需要买一个取暖器。');
    const r = await h.engine.submitAudio(id, { audio: new Blob([new Uint8Array(400)], { type: 'audio/webm' }) });
    expect(r.simulatedTranscript).toBe(true);
    const t = (await h.engine.getThread(id))!;
    expect(t.messages.some((m) => m.kind === 'voice' && m.text.startsWith('Venmo @neighbor-'))).toBe(true);
    expect(t.awaitingConfirmation).toBe(true);
  });

  it('typed text is never reported as a simulated recording', async () => {
    const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_text' });
    const r = await h.engine.submitText(requestId, { text: 'Power is out and I need a heater. My Venmo is @typed-only9' });
    expect(r.simulatedTranscript).toBe(false);
  });
});

describe('decline: idempotent, honest, with a real appeal', () => {
  async function filed() {
    const id = await typed('Power is out since the storm, I need a heater. We are 2 people. My Venmo is @appeal-test1');
    await h.engine.confirmIntake(id, { confirmed: true });
    return id;
  }

  it('declining twice sends one message; "other" without a note never mentions a note', async () => {
    const id = await filed();
    const [a, b, c] = await Promise.all([
      h.engine.decline({ requestId: id, organizerId: 'org_dana', reasonCode: 'other' }),
      h.engine.decline({ requestId: id, organizerId: 'org_marcus', reasonCode: 'outside_area' }),
      h.engine.decline({ requestId: id, organizerId: 'org_dana', reasonCode: 'other' }),
    ]);
    expect(a.message.textEn).not.toMatch(/note/i);
    expect(b.status).toBe('declined');
    expect(c.status).toBe('declined');
    const sent = (await listNotifications(await db(), id)).filter((n) => n.messageKey === 'declined_with_appeal');
    expect(sent).toHaveLength(1);
    const t = (await h.engine.getThread(id))!;
    expect(t.messages.filter((m) => m.kind === 'declined')).toHaveLength(1);
  });

  it('REVIEW reopens it for a different organizer, with the first reason attached; the second decision is final', async () => {
    const id = await filed();
    await h.engine.decline({ requestId: id, organizerId: 'org_dana', reasonCode: 'outside_area' });
    let t = (await h.engine.getThread(id))!;
    expect(t.question).toMatchObject({ key: 'appeal', answers: [{ send: 'REVIEW' }] });

    await h.engine.submitText(id, { text: 'REVIEW' });
    const v = (await h.engine.getRequest(id))!;
    expect(v.request.status).toBe('awaiting_approval');
    expect(v.appeal).toMatchObject({ text: 'REVIEW', firstDecline: { organizerId: 'org_dana', name: 'Dana', reasonCode: 'outside_area', reasonLabel: 'Outside our area' } });
    t = (await h.engine.getThread(id))!;
    expect(t.question).toBeNull();
    expect(t.messages.at(-1)).toMatchObject({ kind: 'ack', from: 'line' });

    await expect(h.engine.decline({ requestId: id, organizerId: 'org_dana', reasonCode: 'outside_area' })).rejects.toMatchObject({ status: 409 });
    const final = await h.engine.decline({ requestId: id, organizerId: 'org_marcus', reasonCode: 'outside_area' });
    expect(final.message.textEn).toMatch(/A second organizer looked/);
    expect(final.message.textEn).not.toMatch(/REVIEW/);
    t = (await h.engine.getThread(id))!;
    expect(t.question).toBeNull();
    await expect(h.engine.submitText(id, { text: 'REVIEW' })).rejects.toMatchObject({ status: 409 });
  });
});
