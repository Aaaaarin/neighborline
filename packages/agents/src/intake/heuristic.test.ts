import { describe, expect, it } from 'vitest';
import { categoryFrom, heuristicExtract, householdFrom } from './heuristic.js';
import { IntakeAgent } from './intake-agent.js';
import { createFixtureLLM } from '../fixtures/responders.js';

const KEYS = ['utility_outage', 'groceries', 'medicine_copay', 'rent_gap', 'transport', 'other'];
const CATS = KEYS.map((key) => ({ key, label: key }));

describe('heuristicExtract (offline fixture extractor)', () => {
  it.each([
    ['zh', '我家停电两天了，需要买一个取暖器。我们家有三口人。', 'utility_outage', 3],
    ['ar', 'انقطعت الكهرباء عن شقتي منذ يومين وأحتاج إلى مدفأة. نحن 4 أشخاص.', 'utility_outage', 4],
    ['ko', '이틀째 정전이라 난방이 안 돼요. 우리 집은 세 명이에요.', 'utility_outage', 3],
    ['ru', 'У нас уже два дня нет света, нужен обогреватель. Нас трое.', 'utility_outage', 3],
    ['fr', "Nous n'avons plus de courant depuis la tempête. Nous sommes 5.", 'utility_outage', 5],
    ['tl', 'Kailangan ko ng pagkain para sa pamilya. 4 na tao kami.', 'groceries', 4],
  ])('%s: category and household from typed text', (lang, text, category, household) => {
    const x = heuristicExtract(text, KEYS);
    expect(x.lang).toBe(lang);
    expect(x.category).toBe(category);
    expect(x.householdSize).toBe(household);
    expect(x.missing).toContain('payout');
    expect(x.missing).not.toContain('category');
  });

  it('finds the written handle inside non-Latin text', () => {
    expect(heuristicExtract('我需要买食物。我的Venmo是@wang-li88', KEYS).payout).toEqual({ wallet: 'VENMO', type: 'USER_HANDLE', value: '@wang-li88' });
    expect(heuristicExtract('식료품이 필요해요. 제 벤모는 @kim-minji 입니다', KEYS).payout?.value).toBe('@kim-minji');
  });

  it('the /call quick answers (policy labels per language) always give a category', () => {
    for (const [label, key] of [
      ['停电或断水断气', 'utility_outage'],
      ['食品杂货', 'groceries'],
      ['المساهمة في ثمن الدواء', 'medicine_copay'],
      ['عجز في الإيجار', 'rent_gap'],
      ['المواصلات', 'transport'],
      ['Copago de medicinas', 'medicine_copay'],
      ['Thiếu tiền thuê nhà', 'rent_gap'],
      ['Нет света или отопления', 'utility_outage'],
      ['교통비', 'transport'],
    ] as const) {
      expect(categoryFrom(`something hard to describe\n${label}`, new Set(KEYS)), label).toBe(key);
    }
  });

  it('"something else" only counts as a whole answer, never inside a sentence', () => {
    expect(categoryFrom('It is complicated\nOtro', new Set(KEYS))).toBe('other');
    expect(categoryFrom('It is complicated\n其他', new Set(KEYS))).toBe('other');
    expect(categoryFrom('my other neighbor told me to call', new Set(KEYS))).toBeUndefined();
    expect(categoryFrom('It is complicated\nOther', new Set(KEYS.filter((k) => k !== 'other')))).toBeUndefined();
  });

  it('household answers in every supported language', () => {
    for (const [s, n] of [
      ['3 people', 3], ['3 personas', 3], ['3 người', 3], ['3 moun', 3], ['3口人', 3], ['٣ أشخاص', 3], ['3 أشخاص', 3],
      ['3 personnes', 3], ['نحن أربعة في البيت', 4], ['3 tao', 3], ['3명', 3], ['3 человека', 3], ['нас пятеро', 5], ['两个人', 2],
    ] as const) {
      expect(householdFrom(s), s).toBe(n);
    }
    expect(householdFrom('I need 300 dollars')).toBeUndefined();
  });

  it('a missing field is a specific question, not "say it again"', async () => {
    const agent = new IntakeAgent({ llm: createFixtureLLM() });
    const zh = await agent.fromText({ text: '我家停电两天了，需要买一个取暖器。', categories: CATS });
    expect(zh.status).toBe('needs_clarification');
    expect(zh.clarifyingQuestion?.key).toBe('ask_payout');
    expect(zh.clarifyingQuestion?.text).toMatch(/PayPal/);
    expect(zh.clarifyingQuestion?.text).not.toMatch(/Where should we/);
  });

  it.each([
    ['ko', '이틀째 정전이에요. 히터가 필요해요.', '돈을 어디로 보내 드릴까요?', '저희가 이해한 내용은'],
    ['ru', 'У нас уже два дня нет света, нужен обогреватель.', 'Куда отправить деньги?', 'Вот как мы вас поняли'],
  ])('%s: the read-back and the question come back in that language (vetted catalog)', async (_lang, text, question, intro) => {
    const agent = new IntakeAgent({ llm: createFixtureLLM() });
    const r = await agent.fromText({ text, categories: CATS });
    expect(r.clarifyingQuestion?.key).toBe('ask_payout');
    expect(r.clarifyingQuestion?.text).toContain(question);
    expect(r.readBack.text).toContain(intro);
  });

  it('ru: answering the question with a handle gives the payout line in Russian with the handle intact', async () => {
    const agent = new IntakeAgent({ llm: createFixtureLLM() });
    const r = await agent.fromText({ text: 'У нас уже два дня нет света, нужен обогреватель.\nМой Venmo @ivan-petrov7', categories: CATS });
    expect(r.status).toBe('awaiting_confirmation');
    expect(r.readBack.text).toContain('деньги придут на ваш Venmo: @ivan-petrov7.');
  });
});

describe('EVAL finding 7 (offline extractor): need over who is mentioned, hunger, household', () => {
  it.each([
    ['The furnace died and the landlord is not answering.', 'utility_outage'],
    ['Se dañó la calefacción y el casero no contesta.', 'utility_outage'],
    ['房东不管，暖气停了。', 'utility_outage'],
    ['The landlord says we are out on Monday if I cannot pay.', 'rent_gap'],
    ['I am short on rent and the landlord is threatening eviction.', 'rent_gap'],
    ['My kids are hungry and there is nothing to eat.', 'groceries'],
    ['Mis hijos tienen hambre.', 'groceries'],
    ['Mga anak ko ay gutom na.', 'groceries'],
    ['Power went out and I need groceries for the kids, the food spoiled.', 'groceries'],
  ])('%s → %s', (text, key) => {
    expect(categoryFrom(text, new Set(KEYS))).toBe(key);
  });

  it.each([
    ['I live alone.', 1], ['Vivo sola.', 1], ['Je vis seul.', 1], ['Mag-isa lang po ako.', 1], ['Живу одна.', 1], ['혼자 살아요.', 1], ['أعيش وحدي.', 1],
    ['It is me and my wife.', 2], ['Just the two of us.', 2], ['Vivo con mi abuela.', 2], ['Mon mari et moi.', 2],
    ['It is me and my 3 kids.', 4], ['Vivo con mis 2 hijas.', 3], ['Je vis avec mes deux enfants.', 3], ['Se mwen ak twa pitit mwen.', 4],
    ['Dalawa lang po kami.', 2], ['Nous sommes quatre.', 4], ['Somos cinco.', 5],
    // QA-2: Kreyòl typed on /call was asked its household after saying it.
    ['Nou 3 nan kay la.', 3], ['Nou kat lakay.', 4],
  ] as const)('%s → %s', (text, n) => {
    expect(householdFrom(text)).toBe(n);
  });

  it('does not read ages, weeks or amounts as a household', () => {
    expect(householdFrom('My mother is 81 and we are 2 weeks behind.')).toBeUndefined();
    expect(householdFrom('I need $40 for 3 days of medicine.')).toBeUndefined();
    expect(householdFrom('Mwen gen 70 an.')).toBeUndefined();
  });
});
