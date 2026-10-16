/**
 * Wraps any LLM and records every call (schema, latency, tokens), so the eval counts all model
 * calls an intake makes: the extraction, its repair, and the read-back translations for languages
 * outside the vetted catalog.
 */
import { BaseLLM } from '../src/providers/base.js';
import type { GenerateJsonArgs, GenerateTextArgs, JsonResult, LLM, TextResult, Usage } from '../src/providers/types.js';

export interface CallRecord {
  schemaName: string;
  latencyMs: number;
  usage: Usage;
  ok: boolean;
}

export class CountingLLM extends BaseLLM {
  readonly kind: LLM['kind'];
  readonly id: string;
  private records: CallRecord[] = [];

  constructor(private readonly inner: LLM) {
    super();
    this.kind = inner.kind;
    this.id = inner.id;
  }

  /** Calls since the last take(), then start a new list. */
  take(): CallRecord[] {
    const out = this.records;
    this.records = [];
    return out;
  }

  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    const t0 = performance.now();
    try {
      const res = await this.inner.generateJson(args);
      this.records.push({ schemaName: args.schemaName, latencyMs: performance.now() - t0, usage: res.usage, ok: true });
      return res;
    } catch (e) {
      this.records.push({ schemaName: args.schemaName, latencyMs: performance.now() - t0, usage: { inputTokens: 0, outputTokens: 0 }, ok: false });
      throw e;
    }
  }

  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    const t0 = performance.now();
    const res = await this.inner.generateText(args);
    this.records.push({ schemaName: 'text', latencyMs: performance.now() - t0, usage: res.usage, ok: true });
    return res;
  }
}
