import { BaseLLM } from './base.js';
import type { GenerateJsonArgs, GenerateTextArgs, JsonResult, LLM, Logger, TextResult } from './types.js';

/** Live model first; on a provider error, answer from the fallback (fixtures) and say so in `model`. */
export class FallbackLLM extends BaseLLM {
  readonly kind = 'fallback' as const;
  readonly id: string;
  constructor(
    private readonly primary: LLM,
    private readonly fallback: LLM,
    private readonly logger?: Logger,
  ) {
    super();
    this.id = `${primary.id}→${fallback.id}`;
  }

  async generateJson(args: GenerateJsonArgs): Promise<JsonResult> {
    try {
      return await this.primary.generateJson(args);
    } catch (e) {
      this.logger?.warn(`${this.primary.id} failed for ${args.schemaName}; using ${this.fallback.id}`, { error: e instanceof Error ? e.message : String(e) });
      const res = await this.fallback.generateJson(args);
      return { ...res, model: `${res.model} (fallback)` };
    }
  }

  async generateText(args: GenerateTextArgs): Promise<TextResult> {
    try {
      return await this.primary.generateText(args);
    } catch (e) {
      this.logger?.warn(`${this.primary.id} failed; using ${this.fallback.id}`, { error: e instanceof Error ? e.message : String(e) });
      return this.fallback.generateText(args);
    }
  }
}
