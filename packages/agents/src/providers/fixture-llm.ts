/**
 * Offline LLM. Deterministic: each schemaName has a responder that answers from fixture files
 * (keyed by content hash) or from a transparent rule-based fallback. No network, no keys.
 */
import { BaseLLM, ProviderError } from './base.js';
import { parseJsonLenient } from './parse-json.js';
import type { ChatMessage, GenerateJsonArgs, GenerateTextArgs, JsonResult, TextResult } from './types.js';

export interface ResponderContext {
  system: string;
  messages: ChatMessage[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** First user message (the original request; repair turns are appended after it). */
  firstUser: string;
  isRepair: boolean;
}
export type Responder = (ctx: ResponderContext) => unknown;

const approxTokens = (s: string): number => Math.ceil(s.length / 4);

export class FixtureLLM extends BaseLLM {
  readonly kind = 'fixture' as const;
  readonly id = 'fixture';
  constructor(private readonly responders: Readonly<Record<string, Responder>>) {
    super();
  }

  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    const responder = this.responders[args.schemaName];
    if (!responder) throw new ProviderError(this.id, `no fixture responder for schema '${args.schemaName}'`);
    const firstUser = args.messages.find((m) => m.role === 'user')?.content ?? '';
    const value = responder({
      system: args.system,
      messages: args.messages,
      schemaName: args.schemaName,
      jsonSchema: args.jsonSchema,
      firstUser,
      isRepair: args.messages.length > 1,
    });
    const raw = JSON.stringify(value);
    return {
      json: value,
      raw,
      usage: { inputTokens: approxTokens(args.system + firstUser), outputTokens: approxTokens(raw) },
      model: 'fixture',
      parseFixes: [],
    };
  }

  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    const last = args.messages[args.messages.length - 1]?.content ?? '';
    return { text: last, usage: { inputTokens: approxTokens(last), outputTokens: approxTokens(last) }, model: 'fixture' };
  }
}

export type ScriptStep = string | ((args: GenerateJsonArgs) => string);

/**
 * Test double that replays raw model outputs in order (e.g. broken JSON first, then a fixed one)
 * and records every call, so tests can assert exactly what the repair call sent.
 */
export class ScriptedLLM extends BaseLLM {
  readonly kind = 'scripted' as const;
  readonly id: string;
  readonly calls: GenerateJsonArgs[] = [];
  private step = 0;
  constructor(private readonly script: ScriptStep[], id = 'scripted') {
    super();
    this.id = id;
  }

  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    this.calls.push(args);
    const next = this.script[this.step++];
    if (next === undefined) throw new ProviderError(this.id, `script exhausted after ${this.script.length} calls`);
    const raw = typeof next === 'function' ? next(args) : next;
    const parsed = parseJsonLenient(raw);
    return {
      json: parsed.ok ? parsed.value : undefined,
      raw,
      usage: { inputTokens: approxTokens(args.system), outputTokens: approxTokens(raw) },
      model: this.id,
      parseFixes: parsed.fixes,
    };
  }

  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    const next = this.script[this.step++];
    const text = typeof next === 'function' ? next({ ...args, jsonSchema: {}, schemaName: 'text' }) : (next ?? '');
    return { text, usage: { inputTokens: 0, outputTokens: 0 }, model: this.id };
  }
}
