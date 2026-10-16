/**
 * OpenAI Chat Completions with Structured Outputs:
 *   response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }
 * Strict mode needs every property required, so optional fields are sent as nullable and the
 * nulls are dropped before zod validation. Refusals come back in `message.refusal`.
 * Verified against openai 7.34.0 type definitions (ResponseFormatJSONSchema, max_completion_tokens).
 */
import OpenAI from 'openai';
import { BaseLLM, ProviderError, safeSchemaName } from './base.js';
import { dropNulls, toStrictSchema } from './json-schema.js';
import { parseJsonLenient } from './parse-json.js';
import type { GenerateJsonArgs, GenerateTextArgs, JsonResult, TextResult, Usage } from './types.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

export interface OpenAILLMOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** e.g. 'low' for reasoning models; omitted when unset. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  client?: Pick<OpenAI, 'chat'>;
}

export class OpenAILLM extends BaseLLM {
  readonly kind = 'openai' as const;
  readonly id: string;
  private readonly client: Pick<OpenAI, 'chat'>;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly reasoningEffort: OpenAILLMOptions['reasoningEffort'];

  constructor(opts: OpenAILLMOptions) {
    super();
    this.model = opts.model ?? DEFAULT_OPENAI_MODEL;
    this.id = `openai:${this.model}`;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.reasoningEffort = opts.reasoningEffort;
    this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 });
  }

  private messages(system: string, messages: GenerateTextArgs['messages']): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
  }

  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages(args.system, args.messages),
        max_completion_tokens: args.maxTokens ?? this.maxTokens,
        ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: safeSchemaName(args.schemaName),
            ...(args.description ? { description: args.description } : {}),
            schema: toStrictSchema(args.jsonSchema, 'openai'),
            strict: true,
          },
        },
      });
    } catch (e) {
      throw new ProviderError(this.id, `chat.completions.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    const message = res.choices[0]?.message;
    const usage = usageOf(res);
    if (!message || message.refusal) {
      return { json: undefined, raw: message?.refusal ?? '(no choices)', usage, model: res.model, parseFixes: [] };
    }
    const raw = message.content ?? '';
    const parsed = parseJsonLenient(raw);
    return {
      json: parsed.ok ? dropNulls(parsed.value) : undefined,
      raw,
      usage,
      model: res.model,
      parseFixes: parsed.fixes,
    };
  }

  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages(args.system, args.messages),
        max_completion_tokens: args.maxTokens ?? this.maxTokens,
        ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
      });
      return { text: res.choices[0]?.message.content ?? '', usage: usageOf(res), model: res.model };
    } catch (e) {
      throw new ProviderError(this.id, `chat.completions.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
  }
}

function usageOf(res: OpenAI.Chat.ChatCompletion): Usage {
  return { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}
