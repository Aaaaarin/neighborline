/**
 * zod → JSON Schema for LLM structured output.
 *
 *  - `zodToLlmJsonSchema`  plain draft-07 schema, refs inlined (what the model sees by default).
 *  - `toStrictSchema`      the subset accepted by constrained decoding ("strict" tools on Claude,
 *                          `strict: true` json_schema on OpenAI): `additionalProperties: false`
 *                          everywhere, unsupported keywords (minLength, maximum, …) moved into the
 *                          description so the model still reads them, and — for OpenAI — every
 *                          property required with optional ones made nullable.
 * zod remains the source of truth: whatever constrained decoding cannot express is enforced by
 * the zod parse + repair loop in validate.ts.
 */
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

type Json = Record<string, unknown>;

export function zodToLlmJsonSchema(schema: ZodTypeAny): Json {
  const out = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Json;
  delete out.$schema;
  delete out.definitions;
  return out;
}

const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
const KEEP = new Set(['type', 'description', 'title', 'enum', 'const', 'properties', 'required', 'items', 'anyOf', 'additionalProperties']);

export type StrictDialect = 'anthropic' | 'openai';

export function toStrictSchema(schema: Json, dialect: StrictDialect): Json {
  return strictNode(structuredClone(schema), dialect);
}

function strictNode(node: Json, dialect: StrictDialect): Json {
  const out: Json = {};
  const moved: string[] = [];
  const anyOf = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (Array.isArray(anyOf)) out.anyOf = anyOf.map((n) => strictNode(n, dialect));

  for (const [k, v] of Object.entries(node)) {
    if (k === 'anyOf' || k === 'oneOf') continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const props = v as Record<string, Json>;
      const required = new Set((node.required as string[] | undefined) ?? []);
      const strictProps: Record<string, Json> = {};
      for (const [name, child] of Object.entries(props)) {
        const s = strictNode(child, dialect);
        strictProps[name] = dialect === 'openai' && !required.has(name) ? nullable(s) : s;
      }
      out.properties = strictProps;
      out.required = dialect === 'openai' ? Object.keys(props) : [...required];
      out.additionalProperties = false;
    } else if (k === 'items' && v && typeof v === 'object' && !Array.isArray(v)) {
      out.items = strictNode(v as Json, dialect);
    } else if (k === 'additionalProperties' || k === 'required') {
      // handled with properties
    } else if (k === 'format' && typeof v === 'string' && SUPPORTED_FORMATS.has(v)) {
      out.format = v;
    } else if (k === 'minItems' && (v === 0 || v === 1)) {
      out.minItems = v;
    } else if (KEEP.has(k)) {
      out[k] = v;
    } else {
      moved.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  if (out.type === 'object' && !('properties' in out)) {
    out.properties = {};
    out.required = [];
    out.additionalProperties = false;
  }
  if (moved.length > 0) {
    const d = typeof out.description === 'string' ? `${out.description}\n\n` : '';
    out.description = `${d}{${moved.join(', ')}}`;
  }
  return out;
}

function nullable(s: Json): Json {
  if (Array.isArray(s.anyOf)) return { ...s, anyOf: [...(s.anyOf as Json[]), { type: 'null' }] };
  if (typeof s.type === 'string' && s.type !== 'object' && !('enum' in s)) return { ...s, type: [s.type, 'null'] };
  return { anyOf: [s, { type: 'null' }] };
}

/**
 * OpenAI strict mode answers optional fields with `null`; zod `.optional()` wants them absent.
 * Drop null-valued object keys (recursively) before validation.
 */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = dropNulls(v);
    return out;
  }
  return value;
}
