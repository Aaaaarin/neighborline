/**
 * OpenAICompatibleLLM against a real HTTP server that imitates Ollama / llama-server's
 * /v1/chat/completions. Proves the wire format and the validate → repair loop over HTTP; it says
 * nothing about how accurate any particular local model is.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoPolicy } from '@neighborline/core';
import { IntakeAgent } from '../intake/intake-agent.js';
import { createProviders } from './create.js';
import { OpenAICompatibleLLM } from './openai-compatible.js';
import type { Logger } from './types.js';

type Reply = { status?: number; content?: string; body?: unknown };
interface Seen {
  url: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

let server: Server;
let baseURL = '';
const seen: Seen[] = [];
let replies: Reply[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
    seen.push({ url: req.url ?? '', auth: req.headers.authorization, body });
    const next = replies.shift() ?? { content: '{}' };
    res.writeHead(next.status ?? 200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        next.body ?? {
          id: 'cmpl-1',
          object: 'chat.completion',
          created: 0,
          model: String(body.model),
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: next.content ?? '' } }],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
        },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const reset = (next: Reply[]): void => {
  seen.length = 0;
  replies = next;
};
const categories = demoPolicy().categories.map((c) => ({ key: c.key, label: c.label.en ?? c.key }));
const quiet = (): Logger & { warnings: string[] } => {
  const warnings: string[] = [];
  return { warnings, info: () => {}, warn: (m) => void warnings.push(m), error: () => {} };
};

const TEXT = 'Hi, this is Doris. Our power has been out since Tuesday. It is me and my husband. My Venmo is at doris dash kemp 48.';
const GOOD = {
  lang: 'en',
  summaryEn: 'Power out since Tuesday; household of 2.',
  summaryNative: 'Your power has been out since Tuesday.',
  category: 'utility_outage',
  householdSize: 2,
  urgency: 'this_week',
  requestedItems: ['space heater'],
  payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@doris-kemp48' },
  missing: [],
  confidence: 0.9,
  englishText: TEXT,
};

describe('OpenAICompatibleLLM over HTTP (mock Ollama / llama-server)', () => {
  it('json_schema mode: POST /v1/chat/completions with the schema as response_format, temperature 0, max_tokens', async () => {
    reset([{ content: JSON.stringify(GOOD) }]);
    const llm = new OpenAICompatibleLLM({ baseURL, model: 'qwen2.5:7b-instruct', maxRetries: 0 });
    const r = await new IntakeAgent({ llm }).fromText({ text: TEXT, categories });

    expect(llm.id).toMatch(/^openai-compatible:qwen2\.5:7b-instruct@127\.0\.0\.1:\d+$/);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('/v1/chat/completions');
    expect(seen[0]?.auth).toBe('Bearer not-needed');
    const body = seen[0]?.body ?? {};
    expect(body).toMatchObject({ model: 'qwen2.5:7b-instruct', temperature: 0, max_tokens: 2048 });
    const rf = body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: { properties: Record<string, unknown> } } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('IntakeExtraction');
    expect(Object.keys(rf.json_schema.schema.properties)).toEqual(expect.arrayContaining(['category', 'payout', 'missing', 'englishText']));
    expect(r.trace.status).toBe('valid');
    expect(r.trace.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    expect(r.extraction?.payout?.value).toBe('@doris-kemp48');
    expect(r.status).toBe('awaiting_confirmation');
  });

  it('a fenced reply is fixed locally; an invented handle triggers ONE repair call over HTTP', async () => {
    const invented = { ...GOOD, payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@eastside-mutualaid' } };
    reset([{ content: '```json\n' + JSON.stringify(invented) + '\n```' }, { content: JSON.stringify(GOOD) }]);
    const llm = new OpenAICompatibleLLM({ baseURL, model: 'llama3.1:8b', maxRetries: 0 });
    const r = await new IntakeAgent({ llm }).fromText({ text: TEXT, categories });

    expect(seen).toHaveLength(2);
    const repairTurn = (seen[1]?.body.messages as Array<{ role: string; content: string }>).at(-1);
    expect(repairTurn?.role).toBe('user');
    expect(repairTurn?.content).toContain('payout.value');
    expect(repairTurn?.content).toContain('does not appear in what the neighbor said');
    expect(r.trace.status).toBe('repaired');
    expect(r.trace.repairedFields).toEqual(['payout.value']);
    expect(r.trace.localFixes.join(' ')).toMatch(/fence/);
    expect(r.extraction?.payout?.value).toBe('@doris-kemp48');
  });

  it('json_object and prompt modes put the schema in the system prompt instead', async () => {
    reset([{ content: JSON.stringify(GOOD) }, { content: 'Sure! ' + JSON.stringify(GOOD) }]);
    for (const structured of ['json_object', 'prompt'] as const) {
      const llm = new OpenAICompatibleLLM({ baseURL, model: 'm', structured, maxRetries: 0 });
      const r = await new IntakeAgent({ llm }).fromText({ text: TEXT, categories });
      expect(r.extraction?.category).toBe('utility_outage');
    }
    const [jsonObject, prompt] = seen;
    expect(jsonObject?.body.response_format).toEqual({ type: 'json_object' });
    expect(prompt?.body.response_format).toBeUndefined();
    for (const s of [jsonObject, prompt]) {
      const system = (s?.body.messages as Array<{ role: string; content: string }>)[0];
      expect(system?.role).toBe('system');
      expect(system?.content).toContain('It must match this JSON Schema:');
      expect(system?.content).toContain('"englishText"');
    }
  });

  it('a server error is recorded in the trace and the neighbor is asked again (no guessing)', async () => {
    reset([{ status: 500, body: { error: { message: 'model not loaded' } } }]);
    const llm = new OpenAICompatibleLLM({ baseURL, model: 'm', maxRetries: 0 });
    const r = await new IntakeAgent({ llm }).fromText({ text: TEXT, categories });
    expect(r.ok).toBe(false);
    expect(r.trace.status).toBe('error');
    expect(r.reasons).toEqual(['invalid_output']);
    expect(r.extraction).toBeNull();
  });
});

describe('createProviders: LLM_PROVIDER=openai-compatible', () => {
  it('builds the local provider from env (alias: ollama)', () => {
    const env = { AI_MODE: 'live', OPENAI_COMPAT_BASE_URL: 'http://localhost:11434/v1', OPENAI_COMPAT_MODEL: 'qwen2.5:7b-instruct' };
    const a = createProviders({ ...env, LLM_PROVIDER: 'openai-compatible' }, quiet());
    const b = createProviders({ ...env, LLM_PROVIDER: 'ollama', OPENAI_COMPAT_STRUCTURED: 'json_object' }, quiet());
    expect(a.llm.id).toBe('openai-compatible:qwen2.5:7b-instruct@localhost:11434');
    expect(b.llm).toBeInstanceOf(OpenAICompatibleLLM);
    expect((b.llm as OpenAICompatibleLLM).structured).toBe('json_object');
    expect([a.stt.id, a.tts.id]).toEqual(['fixture-stt', 'fixture-tts']);
  });

  it('missing settings fall back to fixtures, never to a cloud provider (even when cloud keys exist)', () => {
    const log = quiet();
    const p = createProviders({ AI_MODE: 'live', LLM_PROVIDER: 'openai-compatible', ANTHROPIC_API_KEY: 'k' }, log);
    expect(p.llm.id).toBe('fixture');
    expect(log.warnings.join('\n')).toContain('not to a cloud provider');
  });

  it('says so when audio would still go to OpenAI', () => {
    const p = createProviders(
      { AI_MODE: 'live', LLM_PROVIDER: 'openai-compatible', OPENAI_COMPAT_BASE_URL: 'http://localhost:8080/v1', OPENAI_COMPAT_MODEL: 'm', OPENAI_API_KEY: 'k' },
      quiet(),
    );
    expect(p.llm.id).toBe('openai-compatible:m@localhost:8080');
    expect(p.notes.join('\n')).toContain('Audio goes to OpenAI because OPENAI_API_KEY is set');
  });
});
