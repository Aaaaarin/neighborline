/**
 * Any server that speaks the OpenAI Chat Completions API: a local model behind Ollama
 * (`http://localhost:11434/v1`), llama.cpp's `llama-server` (`http://localhost:8080/v1`), vLLM or
 * LM Studio. For groups that cannot send a neighbor's words to a cloud API.
 *
 * Structured output, in order of preference (`structured`):
 *  - 'json_schema'  response_format: { type: 'json_schema', json_schema: { name, schema, strict } }.
 *                   Servers that support it turn the schema into a decoding grammar.
 *  - 'json_object'  response_format: { type: 'json_object' } (valid JSON, any shape) + the schema in
 *                   the system prompt.
 *  - 'prompt'       no response_format at all; the schema is in the system prompt and the lenient
 *                   parser strips code fences and surrounding prose.
 * Whatever the server does, zod + the semantic checks + one repair call (validate.ts) still decide
 * what is accepted. Nothing here has been measured for accuracy: see docs/EVAL.md before relying on it.
 */
import OpenAI from 'openai';
import { BaseLLM, ProviderError, safeSchemaName } from './base.js';
import { dropNulls } from './json-schema.js';
import { parseJsonLenient } from './parse-json.js';
import type { GenerateJsonArgs, GenerateTextArgs, JsonResult, TextResult, Usage } from './types.js';

export type CompatStructuredMode = 'json_schema' | 'json_object' | 'prompt';
export const COMPAT_STRUCTURED_MODES: readonly CompatStructuredMode[] = ['json_schema', 'json_object', 'prompt'];

export interface OpenAICompatibleLLMOptions {
  /** e.g. http://localhost:11434/v1 (Ollama) or http://localhost:8080/v1 (llama-server). */
  baseURL: string;
  /** Model name as the server knows it, e.g. "qwen2.5:7b-instruct". */
  model: string;
  /** Most local servers ignore it; some (vLLM with --api-key) require one. */
  apiKey?: string;
  structured?: CompatStructuredMode;
  maxTokens?: number;
  /** Default 0: extraction, not creative writing. */
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Inject a client (tests). */
  client?: Pick<OpenAI, 'chat'>;
}

/** Host part of the base URL, for the provider id shown in traces ("openai-compatible:qwen2.5@localhost:11434"). */
function hostOf(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

export function schemaInstruction(schemaName: string, jsonSchema: Record<string, unknown>): string {
  return [
    `Reply with one JSON object only: the ${schemaName}. No prose, no markdown code fence.`,
    'It must match this JSON Schema:',
    JSON.stringify(jsonSchema),
  ].join('\n');
}

export class OpenAICompatibleLLM extends BaseLLM {
  readonly kind = 'openai' as const;
  readonly id: string;
  readonly structured: CompatStructuredMode;
  private readonly client: Pick<OpenAI, 'chat'>;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(opts: OpenAICompatibleLLMOptions) {
    super();
    this.model = opts.model;
    this.structured = opts.structured ?? 'json_schema';
    this.id = `openai-compatible:${this.model}@${hostOf(opts.baseURL)}`;
    this.maxTokens = opts.maxTokens ?? 2048;
    this.temperature = opts.temperature ?? 0;
    this.client =
      opts.client ??
      new OpenAI({ apiKey: opts.apiKey || 'not-needed', baseURL: opts.baseURL, maxRetries: opts.maxRetries ?? 1, timeout: opts.timeoutMs ?? 120_000 });
  }

  private messages(system: string, messages: GenerateTextArgs['messages']): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
  }

  private responseFormat(args: GenerateJsonArgs): OpenAI.Chat.ChatCompletionCreateParams['response_format'] | undefined {
    if (this.structured === 'json_object') return { type: 'json_object' };
    if (this.structured === 'prompt') return undefined;
    return {
      type: 'json_schema',
      json_schema: {
        name: safeSchemaName(args.schemaName),
        ...(args.description ? { description: args.description } : {}),
        // The plain draft-07 schema (not OpenAI's strict subset): grammar-based servers enforce
        // more of it (minLength, maximum, …) and do not need every property required.
        schema: args.jsonSchema,
        strict: true,
      },
    };
  }

  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    const system = this.structured === 'json_schema' ? args.system : `${args.system}\n\n${schemaInstruction(args.schemaName, args.jsonSchema)}`;
    const responseFormat = this.responseFormat(args);
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages(system, args.messages),
        // max_tokens, not max_completion_tokens: what local servers understand.
        max_tokens: args.maxTokens ?? this.maxTokens,
        temperature: this.temperature,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      });
    } catch (e) {
      throw new ProviderError(this.id, `chat.completions.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    const message = res.choices?.[0]?.message;
    const usage = usageOf(res);
    if (!message || message.refusal) {
      return { json: undefined, raw: message?.refusal ?? '(no choices)', usage, model: res.model ?? this.model, parseFixes: [] };
    }
    const raw = message.content ?? '';
    const parsed = parseJsonLenient(raw);
    return { json: parsed.ok ? dropNulls(parsed.value) : undefined, raw, usage, model: res.model ?? this.model, parseFixes: parsed.fixes };
  }

  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages(args.system, args.messages),
        max_tokens: args.maxTokens ?? this.maxTokens,
        temperature: this.temperature,
      });
      return { text: res.choices?.[0]?.message.content ?? '', usage: usageOf(res), model: res.model ?? this.model };
    } catch (e) {
      throw new ProviderError(this.id, `chat.completions.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
  }
}

function usageOf(res: OpenAI.Chat.ChatCompletion): Usage {
  return { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}
