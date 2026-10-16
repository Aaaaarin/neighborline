import type { ZodIssue } from 'zod';
import type {
  GenerateJsonArgs,
  GenerateStructuredArgs,
  GenerateTextArgs,
  JsonResult,
  LLM,
  StructuredResult,
  TextResult,
} from './types.js';
import { zodToLlmJsonSchema } from './json-schema.js';

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

export class SchemaValidationError extends Error {
  constructor(
    readonly schemaName: string,
    readonly issues: ZodIssue[],
    readonly raw: string,
  ) {
    super(`${schemaName} failed validation: ${issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    this.name = 'SchemaValidationError';
  }
}

/** Shared generateStructured on top of a provider's generateJson. */
export abstract class BaseLLM implements LLM {
  abstract readonly id: string;
  abstract readonly kind: LLM['kind'];
  abstract generateJson(args: GenerateJsonArgs): Promise<JsonResult>;
  abstract generateText(args: GenerateTextArgs): Promise<TextResult>;

  async generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<StructuredResult<T>> {
    const res = await this.generateJson({
      system: args.system,
      messages: args.messages,
      jsonSchema: zodToLlmJsonSchema(args.schema),
      schemaName: args.schemaName,
      ...(args.description ? { description: args.description } : {}),
      ...(args.maxTokens ? { maxTokens: args.maxTokens } : {}),
    });
    const parsed = args.schema.safeParse(res.json);
    if (!parsed.success) throw new SchemaValidationError(args.schemaName, parsed.error.issues, res.raw);
    return { value: parsed.data, raw: res.raw, usage: res.usage, model: res.model };
  }
}

/** API-safe tool/format name: [A-Za-z0-9_-]{1,64}. */
export function safeSchemaName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return s.length > 0 ? s : 'output';
}
