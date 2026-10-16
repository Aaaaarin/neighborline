import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ScriptedLLM } from './providers/fixture-llm.js';
import { ProviderError } from './providers/base.js';
import { runStructured } from './validate.js';

const Thing = z.object({
  name: z.string().min(1),
  count: z.number().int().min(0),
  payout: z.object({ wallet: z.enum(['PAYPAL', 'VENMO']), value: z.string() }).optional(),
});

const base = { system: 'sys', messages: [{ role: 'user' as const, content: 'extract' }], schema: Thing, schemaName: 'Thing' };
let t = 0;
const clock = (): number => (t += 100);

describe('runStructured: generate → validate → repair → validate', () => {
  it('passes valid output through on the first try', async () => {
    const llm = new ScriptedLLM(['{"name":"a","count":1}']);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.ok).toBe(true);
    expect(r.trace.status).toBe('valid');
    expect(r.trace.attempts).toHaveLength(1);
    expect(r.trace.summary).toMatch(/^Thing valid on first try/);
  });

  it('repairs broken output with ONE call that shows the model its errors', async () => {
    const llm = new ScriptedLLM([
      '{"name":"a","count":"two","payout":{"wallet":"CASHAPP","value":"@a"}}',
      '{"name":"a","count":2,"payout":{"wallet":"VENMO","value":"@a"}}',
    ]);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.count).toBe(2);
    expect(r.trace.status).toBe('repaired');
    expect(r.trace.repairedFields).toEqual(['count', 'payout.wallet']);
    expect(r.trace.summary).toMatch(/^Schema repaired 2 fields \(count, payout\.wallet\) · 1 repair call/);
    expect(r.trace.attempts.map((a) => [a.kind, a.ok])).toEqual([['generate', false], ['repair', true]]);
    expect(r.trace.attempts[0]?.issues.map((i) => i.path)).toEqual(['count', 'payout.wallet']);

    const repair = llm.calls[1];
    expect(repair?.messages).toHaveLength(3);
    expect(repair?.messages[1]).toEqual({ role: 'assistant', content: '{"name":"a","count":"two","payout":{"wallet":"CASHAPP","value":"@a"}}' });
    expect(repair?.messages[2]?.content).toContain('- count: Expected number, received string');
    expect(repair?.messages[2]?.content).toContain('- payout.wallet:');
    expect(repair?.messages[2]?.content).toContain('keep every other field exactly as it was');
  });

  it('reports a single repaired field in the UI summary', async () => {
    const llm = new ScriptedLLM(['{"name":"","count":3}', '{"name":"b","count":3}']);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.trace.summary).toMatch(/^Schema repaired 1 field \(name\)/);
  });

  it('repairs unparseable JSON (truncated output)', async () => {
    const llm = new ScriptedLLM(['{"name":"a","cou', '{"name":"a","count":0}']);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.ok).toBe(true);
    expect(r.trace.attempts[0]?.issues[0]).toMatchObject({ path: '(root)', source: 'json' });
  });

  it('fixes code fences and nulls locally without an extra model call', async () => {
    const llm = new ScriptedLLM(['```json\n{"name":"a","count":1,"payout":null,}\n```']);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.ok).toBe(true);
    expect(llm.calls).toHaveLength(1);
    expect(r.trace.status).toBe('locally_fixed');
    expect(r.trace.localFixes).toEqual(['stripped markdown code fence', 'removed trailing commas', 'dropped null values for optional fields']);
  });

  it('gives up after one repair and returns the errors (caller re-asks the human)', async () => {
    const llm = new ScriptedLLM(['{"name":1}', '{"name":2}', '{"name":"never called"}']);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(llm.calls).toHaveLength(2);
    expect(r.trace.status).toBe('invalid');
    expect(r.errors.map((e) => e.path)).toEqual(['name', 'count']);
    expect(r.trace.summary).toBe('Schema still invalid after 1 repair (2 issues) · not guessing');
  });

  it('semantic checks (e.g. grounding) also drive the repair call', async () => {
    const llm = new ScriptedLLM(['{"name":"invented","count":1}', '{"name":"said","count":1}']);
    const r = await runStructured({
      ...base, llm, clock,
      semanticCheck: (v) => (v.name === 'said' ? [] : [{ path: 'name', source: 'semantic', message: 'not in the source text' }]),
    });
    expect(r.ok).toBe(true);
    expect(llm.calls[1]?.messages[2]?.content).toContain('- name: not in the source text');
    expect(r.trace.repairedFields).toEqual(['name']);
  });

  it('returns the schema-valid value when only semantic issues remain', async () => {
    const llm = new ScriptedLLM(['{"name":"x","count":1}', '{"name":"x","count":1}']);
    const r = await runStructured({ ...base, llm, clock, semanticCheck: () => [{ path: 'name', source: 'semantic', message: 'nope' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.schemaValidValue).toEqual({ name: 'x', count: 1 });
  });

  it('records provider errors instead of throwing', async () => {
    const llm = new ScriptedLLM([(() => { throw new ProviderError('scripted', 'rate limited'); }) as () => string]);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.ok).toBe(false);
    expect(r.trace.status).toBe('error');
    expect(r.trace.summary).toContain('rate limited');
  });

  it('sends the zod schema as JSON Schema to the provider', async () => {
    const llm = new ScriptedLLM(['{"name":"a","count":1}']);
    await runStructured({ ...base, llm, clock });
    expect(llm.calls[0]?.jsonSchema).toMatchObject({ type: 'object', required: ['name', 'count'], properties: { count: { type: 'integer', minimum: 0 } } });
  });

  it('measures latency and tokens per attempt', async () => {
    const llm = new ScriptedLLM(['{"name":1,"count":1}', '{"name":"a","count":1}']);
    const r = await runStructured({ ...base, llm, clock });
    expect(r.trace.attempts.every((a) => a.latencyMs === 100)).toBe(true);
    expect(r.trace.totalLatencyMs).toBe(200);
    expect(r.trace.usage.outputTokens).toBeGreaterThan(0);
  });
});
