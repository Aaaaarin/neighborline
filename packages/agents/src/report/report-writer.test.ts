import { describe, expect, it } from 'vitest';
import { buildReport, type ReportInput } from '@neighborline/core';
import { createFixtureLLM } from '../fixtures/responders.js';
import { ScriptedLLM } from '../providers/fixture-llm.js';
import { extractNumbers, ungroundedNumbers, wordCount } from '../numbers.js';
import { allowedNumbers, buildFacts } from './facts.js';
import { FixtureInflowSource, PayPalToolkitInflowSource, parseTransactionSearch, summarizeInflows } from './inflows.js';
import { MAX_WORDS, MIN_WORDS, ReportWriter } from './report-writer.js';
import { templateNarrative } from './template.js';

const at = (min: number): string => new Date(Date.UTC(2026, 9, 15, 12, min)).toISOString();
const people: Array<[string, string, string, number, number]> = [
  // id, lang, rule, amountCents, seconds to cash
  ['r1', 'vi', 'utility_outage', 15000, 94], ['r2', 'vi', 'utility_outage', 15000, 88], ['r3', 'es', 'utility_outage', 12000, 140],
  ['r4', 'es', 'groceries', 10000, 75], ['r5', 'es', 'groceries', 10000, 102], ['r6', 'ht', 'groceries', 8000, 66],
  ['r7', 'en', 'transport', 6000, 120], ['r8', 'ht', 'medicine_copay', 6000, 91], ['r9', 'en', 'medicine_copay', 12000, 99],
];
const input: ReportInput = {
  requests: people.map(([id, lang, rule], i) => ({ id, lang, ruleKey: rule, createdAt: at(i * 5), status: 'paid', householdKey: `h${id}` })),
  items: people.map(([id, , , cents, secs], i) => ({
    requestId: id, amountCents: cents, wallet: i % 2 ? 'PAYPAL' : 'VENMO', status: 'SUCCESS',
    successAt: new Date(Date.parse(at(i * 5)) + secs * 1000).toISOString(), wasUnclaimed: id === 'r4', transactionId: `TX${i}`,
  })),
  donations: [50_00, 250_00, 25_00, 100_00, 75_50, 600_00].map((amountCents, i) => ({ amountCents, at: at(i), source: 'PAYPAL', donorKey: `d${i}`, transactionId: `D${i}` })),
};
const report = buildReport(input);
const labels = { utility_outage: 'Utility outage', groceries: 'Groceries', medicine_copay: 'Medicine co-pay', transport: 'Transport' };

describe('ReportWriter', () => {
  it('fixture mode: 120–200 words, and every number in the text is in the facts', async () => {
    const r = await new ReportWriter({ llm: createFixtureLLM() }).write({ report, groupName: 'Eastside Mutual Aid', categoryLabels: labels });
    const words = wordCount(r.narrative);
    expect(words).toBeGreaterThanOrEqual(MIN_WORDS);
    expect(words).toBeLessThanOrEqual(MAX_WORDS);
    expect(ungroundedNumbers(r.narrative, allowedNumbers(r.facts))).toEqual([]);
    expect(r.numberTrace.every((n) => n.factKey !== '(ungrounded)')).toBe(true);
    expect(r.narrative).toContain('$1,100.50');
    expect(r.source).toBe('llm');
    expect(r.trace.status).toBe('valid');
  });

  it('a narrative with an invented number is regenerated once with the offending numbers listed', async () => {
    const facts = buildFacts(report, { categoryLabels: labels });
    const good = templateNarrative(facts);
    const bad = { ...good, narrative: good.narrative.replace(/\.$/, '. That is about 1.5 minutes faster than last year.') };
    const llm = new ScriptedLLM([JSON.stringify(bad), JSON.stringify(good)]);
    const r = await new ReportWriter({ llm }).write({ report, categoryLabels: labels });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.messages[2]?.content).toContain('narrative: uses numbers that are not in the facts: 1.5');
    expect(r.trace.status).toBe('repaired');
    expect(r.source).toBe('llm');
    expect(r.narrative).toBe(good.narrative);
  });

  it('two ungrounded narratives → deterministic template (still fully grounded)', async () => {
    const bogus = JSON.stringify({ headline: 'We helped 500 families', narrative: 'word '.repeat(150) });
    const r = await new ReportWriter({ llm: new ScriptedLLM([bogus, bogus]) }).write({ report, categoryLabels: labels });
    expect(r.source).toBe('template');
    expect(r.trace.notes).toContain('fell back to the deterministic template narrative');
    expect(ungroundedNumbers(`${r.headline} ${r.narrative}`, allowedNumbers(r.facts))).toEqual([]);
  });

  it('includes PayPal inflows read via the Agent Toolkit adapter (fixture source)', async () => {
    const r = await new ReportWriter({ llm: createFixtureLLM() }).write({
      report, inflowSource: new FixtureInflowSource(), inflowRange: { startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-17T00:00:00Z' },
    });
    expect(r.inflows).toMatchObject({ source: 'fixture', count: 5, totalCents: 50050 });
    expect(r.facts.find((f) => f.key === 'paypal_inflows')?.value).toBe('$500.50 in 5 transactions');
    expect(r.narrative).toContain('$500.50 in 5 transactions');
  });

  it('masked (k-anonymous) groups never surface as numbers', () => {
    const facts = buildFacts(report, { categoryLabels: labels });
    const transport = facts.find((f) => f.key === 'category.transport');
    expect(transport?.value).toBe('fewer than 5 payouts (amount not shown)');
  });
});

describe('number grounding', () => {
  it('extracts numbers with separators, decimals and percents', () => {
    expect(extractNumbers('Gave $1,350.50 to 12 people (83%) in 2026; handle @lan-nguyen54').map((n) => n.value)).toEqual([1350.5, 12, 83, 2026]);
  });
  it('flags numbers not in the allowed set', () => {
    expect(ungroundedNumbers('94 seconds, about 1.6 minutes, 3 people', [94, 1.6]).map((n) => n.text)).toEqual(['3']);
  });
});

describe('inflows (PayPal Transaction Search shape)', () => {
  it('parses string amounts to cents and keeps only positive completed inflows', () => {
    const inflows = parseTransactionSearch({ transaction_details: [
      { transaction_info: { transaction_id: 'A', transaction_amount: { currency_code: 'USD', value: '75.50' }, transaction_status: 'S' } },
      { transaction_info: { transaction_id: 'B', transaction_amount: { currency_code: 'USD', value: '-150.00' }, transaction_status: 'S' } },
      { transaction_info: { transaction_id: 'C', transaction_amount: { currency_code: 'USD', value: '40.00' }, transaction_status: 'P' } },
    ] });
    expect(inflows.map((i) => [i.transactionId, i.amountCents])).toEqual([['A', 7550], ['C', 4000]]);
    expect(summarizeInflows(inflows, 'x')).toEqual({ source: 'x', count: 1, totalCents: 7550, transactionIds: ['A'] });
  });

  it('calls the toolkit list_transactions tool with fixed, read-only arguments', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const toolkit = {
      handleToolCall: async (c: { function: { name: string; arguments: string } }) => {
        calls.push({ name: c.function.name, args: JSON.parse(c.function.arguments) as Record<string, unknown> });
        return { content: JSON.stringify({ transaction_details: [{ transaction_info: { transaction_id: 'T1', transaction_amount: { currency_code: 'USD', value: '20.00' }, transaction_status: 'S' } }] }) };
      },
    };
    const src = new PayPalToolkitInflowSource({ clientId: 'id', clientSecret: 'secret', toolkit });
    const out = await src.listInflows({ startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-16T00:00:00Z' });
    expect(calls).toEqual([{ name: 'list_transactions', args: { start_date: '2026-10-01T00:00:00Z', end_date: '2026-10-16T00:00:00Z', transaction_status: 'S', page_size: 500, page: 1 } }]);
    expect(out[0]?.amountCents).toBe(2000);
  });

  it('surfaces toolkit errors', async () => {
    const toolkit = { handleToolCall: async () => ({ content: JSON.stringify({ error: { message: 'invalid client', type: 'paypal_error' } }) }) };
    await expect(new PayPalToolkitInflowSource({ clientId: 'x', clientSecret: 'y', toolkit }).listInflows({ startDate: 'a', endDate: 'b' })).rejects.toThrow('invalid client');
  });
});
