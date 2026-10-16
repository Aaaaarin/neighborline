/**
 * Claude via the Messages API. Structured output = one forced tool call:
 *   tools: [{ name, description, input_schema, strict }]
 *   tool_choice: { type: 'tool', name, disable_parallel_tool_use: true }
 * With `strict: true` Claude's constrained decoding guarantees the tool input matches the schema
 * (we send the strict-compatible subset; zod still validates everything else).
 * Verified against @anthropic-ai/sdk 0.135.0 type definitions (Tool.strict, ToolChoiceTool).
 */
import Anthropic from '@anthropic-ai/sdk';
import { BaseLLM, ProviderError, safeSchemaName } from './base.js';
import { toStrictSchema } from './json-schema.js';
import type { GenerateJsonArgs, GenerateTextArgs, JsonResult, TextResult, Usage } from './types.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

export interface AnthropicLLMOptions {
  apiKey: string;
  model?: string;
  /** Constrained decoding for the forced tool (default true). */
  strictTools?: boolean;
  maxTokens?: number;
  /** Inject a client (tests). */
  client?: Pick<Anthropic, 'messages'>;
}

type MessagesClient = Pick<Anthropic, 'messages'>;

export class AnthropicLLM extends BaseLLM {
  readonly kind = 'anthropic' as const;
  readonly id: string;
  private readonly client: MessagesClient;
  private readonly model: string;
  private readonly strict: boolean;
  private readonly maxTokens: number;

  constructor(opts: AnthropicLLMOptions) {
    super();
    this.model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.id = `anthropic:${this.model}`;
    this.strict = opts.strictTools ?? true;
    this.maxTokens = opts.maxTokens ?? 2048;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    const name = safeSchemaName(args.schemaName);
    const inputSchema = this.strict ? toStrictSchema(args.jsonSchema, 'anthropic') : args.jsonSchema;
    let msg: Anthropic.Message;
    try {
      msg = await this.client.messages.create({
        model: this.model,
        max_tokens: args.maxTokens ?? this.maxTokens,
        system: args.system,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
        tools: [
          {
            name,
            description: args.description ?? `Record the ${args.schemaName} as structured data.`,
            input_schema: inputSchema as Anthropic.Tool.InputSchema,
            ...(this.strict ? { strict: true } : {}),
          },
        ],
        tool_choice: { type: 'tool', name, disable_parallel_tool_use: true },
      });
    } catch (e) {
      throw new ProviderError(this.id, `messages.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === name);
    if (!block) {
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      // No tool call (e.g. refusal / max_tokens): surface the text so the repair loop can show it.
      return { json: undefined, raw: text || `(no tool_use; stop_reason=${msg.stop_reason})`, usage: usageOf(msg), model: msg.model, parseFixes: [] };
    }
    return { json: block.input, raw: JSON.stringify(block.input), usage: usageOf(msg), model: msg.model, parseFixes: [] };
  }

  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    try {
      const msg = await this.client.messages.create({
        model: this.model,
        max_tokens: args.maxTokens ?? this.maxTokens,
        system: args.system,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return { text, usage: usageOf(msg), model: msg.model };
    } catch (e) {
      throw new ProviderError(this.id, `messages.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
  }
}

function usageOf(msg: Anthropic.Message): Usage {
  return { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
}
