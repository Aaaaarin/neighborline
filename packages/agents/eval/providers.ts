/**
 * Which model the eval measures.
 *
 *  fixture             FixtureLLM: the offline keyword extractor (src/intake/heuristic.ts). No model.
 *  oracle              A "perfect model" that answers every extraction with the human gold labels.
 *                      Measures the ceiling of the deterministic pipeline around the model
 *                      (grounding, normalization, status rules): whatever it loses, any model loses.
 *  live                AnthropicLLM / OpenAILLM / OpenAICompatibleLLM with real keys or a real server.
 *                      Refuses to start without them (never silently measures fixtures instead).
 *  live --dry-run      The same provider classes, but the vendor client is a mock (Anthropic, OpenAI)
 *                      or a mock HTTP server (openai-compatible). It exercises the live code path
 *                      end to end: request building, strict schemas, tool/JSON parsing, the repair
 *                      loop. Its numbers describe the mock, not a model.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createFixtureLLM, FIXTURE_RESPONDERS } from '../src/fixtures/responders.js';
import { FixtureLLM } from '../src/providers/fixture-llm.js';
import { BaseLLM } from '../src/providers/base.js';
import type { EvalCase } from './dataset.js';
import { readDataBlock } from '../src/prompt-safety.js';
import { AnthropicLLM, DEFAULT_ANTHROPIC_MODEL } from '../src/providers/anthropic.js';
import { OpenAILLM, DEFAULT_OPENAI_MODEL } from '../src/providers/openai-llm.js';
import { OpenAICompatibleLLM, COMPAT_STRUCTURED_MODES, type CompatStructuredMode } from '../src/providers/openai-compatible.js';
import type { ChatMessage, GenerateJsonArgs, GenerateTextArgs, JsonResult, LLM, TextResult } from '../src/providers/types.js';

export type EvalMode = 'fixture' | 'oracle' | 'live';
export const EVAL_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export type EvalProvider = (typeof EVAL_PROVIDERS)[number];

export interface EvalLLMOptions {
  mode: EvalMode;
  provider?: EvalProvider;
  model?: string;
  baseURL?: string;
  dryRun?: boolean;
  env?: Record<string, string | undefined>;
  /** Needed by the oracle: the cases whose gold labels it answers with. */
  cases?: readonly EvalCase[];
}

export interface EvalLLM {
  llm: LLM;
  /** Short name for the result file: "heuristic", "claude-sonnet-5-5", "mock-anthropic". */
  label: string;
  /** What is being measured, in one sentence, for the report. */
  measures: string;
  provider: EvalProvider | 'fixture' | 'oracle';
  model: string;
  dryRun: boolean;
  close: () => Promise<void>;
}

const noop = async (): Promise<void> => {};

export async function buildEvalLLM(opts: EvalLLMOptions): Promise<EvalLLM> {
  const env = opts.env ?? process.env;
  if (opts.mode === 'fixture') {
    return {
      llm: createFixtureLLM(),
      label: 'heuristic',
      measures:
        'FixtureLLM, i.e. the offline keyword extractor in src/intake/heuristic.ts (no language model), followed by the real grounding, validation and rail code.',
      provider: 'fixture',
      model: 'heuristic',
      dryRun: false,
      close: noop,
    };
  }
  if (opts.mode === 'oracle') {
    return {
      llm: new OracleLLM(opts.cases ?? []),
      label: 'gold-oracle',
      measures:
        'a perfect "model" that answers each extraction with the human gold labels (original text as its English translation), followed by the real grounding, validation and rail code: the ceiling of the pipeline around the model.',
      provider: 'oracle',
      model: 'gold-oracle',
      dryRun: false,
      close: noop,
    };
  }
  const provider = opts.provider ?? 'anthropic';
  if (opts.dryRun) return dryRunLLM(provider, opts);

  if (provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error('live eval with --provider anthropic needs ANTHROPIC_API_KEY (or use --dry-run to test the code path with a mock)');
    const model = opts.model ?? env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
    return live(new AnthropicLLM({ apiKey, model, strictTools: env.ANTHROPIC_STRICT_TOOLS !== 'false' }), provider, model);
  }
  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('live eval with --provider openai needs OPENAI_API_KEY (or use --dry-run)');
    const model = opts.model ?? env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    return live(new OpenAILLM({ apiKey, model }), provider, model);
  }
  const baseURL = opts.baseURL ?? env.OPENAI_COMPAT_BASE_URL;
  const model = opts.model ?? env.OPENAI_COMPAT_MODEL;
  if (!baseURL || !model) throw new Error('live eval with --provider openai-compatible needs --base-url and --model (or OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_MODEL)');
  const structured = COMPAT_STRUCTURED_MODES.find((m) => m === env.OPENAI_COMPAT_STRUCTURED) as CompatStructuredMode | undefined;
  const llm = new OpenAICompatibleLLM({ baseURL, model, ...(env.OPENAI_COMPAT_API_KEY ? { apiKey: env.OPENAI_COMPAT_API_KEY } : {}), ...(structured ? { structured } : {}) });
  return live(llm, provider, model);
}

function live(llm: LLM, provider: EvalProvider, model: string): EvalLLM {
  return { llm, label: slug(model), measures: `${llm.id}, called live, followed by the real grounding, validation and rail code.`, provider, model, dryRun: false, close: noop };
}

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'model';

// ── The mock model behind --dry-run ──────────────────────────────────────────────────────────────

/**
 * Answers like the fixture provider, but misbehaves on a deterministic 30% of first extraction
 * attempts so the repair loop runs: 10% invent the group's own handle (grounding repair), 10% drop
 * a required field (schema repair), 10% wrap the JSON in a code fence (local fix; JSON providers
 * only — a tool call cannot be fenced, so Anthropic gets a dropped field instead).
 */
export function mockModel(fenceable: boolean) {
  const fixture = createFixtureLLM();
  return async (system: string, messages: ChatMessage[], schemaName: string | null): Promise<{ text: string; inTokens: number; outTokens: number }> => {
    const inTokens = Math.ceil((system.length + messages.reduce((a, m) => a + m.content.length, 0)) / 4);
    if (!schemaName) {
      const text = (await fixture.generateText({ system, messages })).text;
      return { text, inTokens, outTokens: Math.ceil(text.length / 4) };
    }
    const res = await fixture.generateJson({ system, messages: messages.slice(0, 1), jsonSchema: {}, schemaName });
    let value = res.json as Record<string, unknown>;
    let text = JSON.stringify(value);
    if (schemaName === 'IntakeExtraction' && messages.length === 1) {
      const request = readDataBlock(messages[0]?.content ?? '', 'request_text') ?? '';
      const bucket = parseInt(createHash('sha256').update(request).digest('hex').slice(0, 8), 16) % 10;
      if (bucket === 0) value = { ...value, payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@eastside-mutualaid' }, missing: [] };
      if (bucket === 1 || (bucket === 2 && !fenceable)) {
        const { urgency: _drop, ...rest } = value;
        value = rest;
      }
      text = JSON.stringify(value);
      if (bucket === 2 && fenceable) text = '```json\n' + text + '\n```';
    }
    return { text, inTokens, outTokens: Math.ceil(text.length / 4) };
  };
}

type AnthropicReq = { model: string; system: string; messages: ChatMessage[]; tools?: Array<{ name: string }> };
type OpenAIReq = { model: string; messages: Array<{ role: string; content: string }>; response_format?: { type: string; json_schema?: { name: string } } };

const splitSystem = (msgs: OpenAIReq['messages']) => ({
  system: msgs.find((m) => m.role === 'system')?.content ?? '',
  messages: msgs.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as ChatMessage['role'], content: m.content })),
});
const schemaFromPrompt = (system: string): string | null => /Reply with one JSON object only: the (\w+)\./.exec(system)?.[1] ?? null;

async function dryRunLLM(provider: EvalProvider, opts: EvalLLMOptions): Promise<EvalLLM> {
  const measures = `the ${provider} provider code path against a MOCK model (dry run). These numbers describe the mock, not any real model.`;
  if (provider === 'anthropic') {
    const model = mockModel(false);
    const client = {
      messages: {
        create: async (req: AnthropicReq) => {
          const tool = req.tools?.[0]?.name ?? null;
          const out = await model(req.system, req.messages, tool);
          const usage = { input_tokens: out.inTokens, output_tokens: out.outTokens };
          if (!tool) return { model: req.model, stop_reason: 'end_turn', usage, content: [{ type: 'text', text: out.text }] };
          return { model: req.model, stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'toolu_mock', name: tool, input: JSON.parse(out.text) }] };
        },
      },
    };
    const m = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
    return { llm: new AnthropicLLM({ apiKey: 'dry-run', model: m, client: client as never }), label: 'mock-anthropic', measures, provider, model: m, dryRun: true, close: noop };
  }
  if (provider === 'openai') {
    const model = mockModel(true);
    const client = {
      chat: {
        completions: {
          create: async (req: OpenAIReq) => {
            const { system, messages } = splitSystem(req.messages);
            const out = await model(system, messages, req.response_format?.json_schema?.name ?? null);
            return { model: req.model, usage: { prompt_tokens: out.inTokens, completion_tokens: out.outTokens }, choices: [{ message: { content: out.text, refusal: null } }] };
          },
        },
      },
    };
    const m = opts.model ?? DEFAULT_OPENAI_MODEL;
    return { llm: new OpenAILLM({ apiKey: 'dry-run', model: m, client: client as never }), label: 'mock-openai', measures, provider, model: m, dryRun: true, close: noop };
  }
  // openai-compatible: a real HTTP server on 127.0.0.1 speaking /v1/chat/completions.
  const { server, baseURL } = await startMockCompatServer(mockModel(true));
  const m = opts.model ?? 'mock-local-model';
  const llm = new OpenAICompatibleLLM({ baseURL, model: m, maxRetries: 0 });
  return {
    llm,
    label: 'mock-openai-compatible',
    measures,
    provider,
    model: m,
    dryRun: true,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

export async function startMockCompatServer(model: ReturnType<typeof mockModel>): Promise<{ server: Server; baseURL: string }> {
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      const body = JSON.parse(await readBody(req)) as OpenAIReq;
      const { system, messages } = splitSystem(body.messages);
      const schemaName = body.response_format?.json_schema?.name ?? schemaFromPrompt(system);
      const out = await model(system, messages, schemaName);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: out.text } }],
          usage: { prompt_tokens: out.inTokens, completion_tokens: out.outTokens, total_tokens: out.inTokens + out.outTokens },
        }),
      );
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: e instanceof Error ? e.message : String(e) } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` };
}

// ── The oracle ───────────────────────────────────────────────────────────────────────────────────

const unescapeData = (t: string): string => t.replace(/‹/g, '<').replace(/›/g, '>');

/** Gold labels as an IntakeExtraction answer (+ englishText). Translations go to the fixture responders. */
export function oracleAnswer(c: EvalCase): Record<string, unknown> {
  const g = c.gold;
  return {
    lang: c.lang,
    summaryEn: `Request in ${c.lang} (oracle).`,
    summaryNative: c.text.slice(0, 280),
    category: g.category,
    ...(g.householdSize !== null ? { householdSize: g.householdSize } : {}),
    urgency: 'this_week',
    requestedItems: [],
    ...(g.requestedAmountCents !== undefined ? { requestedAmountCents: g.requestedAmountCents } : {}),
    ...(g.payout ? { payout: g.payout } : {}),
    missing: g.missing,
    confidence: 0.9,
    englishText: c.text,
  };
}

class OracleLLM extends BaseLLM {
  readonly kind = 'fixture' as const;
  readonly id = 'gold-oracle';
  private readonly fixture: FixtureLLM;
  private readonly byText: Map<string, EvalCase>;
  constructor(cases: readonly EvalCase[]) {
    super();
    this.byText = new Map(cases.map((c) => [c.text.trim(), c]));
    this.fixture = new FixtureLLM({
      ...FIXTURE_RESPONDERS,
      IntakeExtraction: (ctx) => {
        const text = unescapeData(readDataBlock(ctx.firstUser, 'request_text') ?? '').trim();
        const c = this.byText.get(text);
        if (!c) throw new Error('oracle: request text is not in the dataset');
        return oracleAnswer(c);
      },
    });
  }
  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    return { ...(await this.fixture.generateJson(args)), model: this.id };
  }
  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    return this.fixture.generateText(args);
  }
}
