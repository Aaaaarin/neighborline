/**
 * The structured-output pipeline every agent uses:
 *
 *   generate → parse JSON (lenient, local fixes) → zod parse → semantic checks (grounding etc.)
 *     └─ invalid? → ONE repair call that shows the model its own output + the exact issues
 *          → parse again → still invalid? → { ok: false, errors }  (caller re-asks the human)
 *
 * Every step is recorded in a trace the UI can render ("Schema repaired 1 field: payout.value").
 */
import type { ZodIssue, ZodType, ZodTypeDef } from 'zod';
import { ProviderError } from './providers/base.js';
import { dropNulls, zodToLlmJsonSchema } from './providers/json-schema.js';
import type { ChatMessage, LLM, Usage } from './providers/types.js';

export type IssueSource = 'json' | 'schema' | 'semantic' | 'provider';
export interface ValidationIssue {
  path: string;
  message: string;
  source: IssueSource;
}

export interface AttemptTrace {
  n: number;
  kind: 'generate' | 'repair';
  latencyMs: number;
  ok: boolean;
  issues: ValidationIssue[];
  localFixes: string[];
  usage: Usage;
  model: string;
  /** First 600 chars of the model output (for the "show raw" toggle). */
  rawPreview: string;
}

export type TraceStatus = 'valid' | 'locally_fixed' | 'repaired' | 'invalid' | 'error';
export interface StructuredTrace {
  schemaName: string;
  label?: string;
  provider: string;
  status: TraceStatus;
  attempts: AttemptTrace[];
  /** Field paths that were invalid at first and valid after the repair call. */
  repairedFields: string[];
  localFixes: string[];
  totalLatencyMs: number;
  usage: Usage;
  /** One line for the UI. */
  summary: string;
  /** Post-validation notes added by agents (e.g. "payout normalized from speech"). */
  notes: string[];
}

export type StructuredOutcome<T> =
  | { ok: true; value: T; trace: StructuredTrace }
  | {
      ok: false;
      errors: ValidationIssue[];
      trace: StructuredTrace;
      lastRaw: string;
      /** Last output that passed zod but failed semantic checks (lets callers drop ungrounded optional fields). */
      schemaValidValue?: T;
    };

export interface RunStructuredArgs<T> {
  llm: LLM;
  system: string;
  messages: ChatMessage[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  schemaName: string;
  description?: string;
  /** Checks zod cannot express (grounding, cross-field rules). Issues trigger the repair call. */
  semanticCheck?: (value: T) => ValidationIssue[];
  /** Default 1. */
  maxRepairs?: number;
  maxTokens?: number;
  label?: string;
  clock?: () => number;
}

export const formatPath = (path: ReadonlyArray<string | number>): string =>
  path.length === 0 ? '(root)' : path.reduce<string>((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : acc ? `${acc}.${p}` : p), '');

export const zodIssues = (issues: ZodIssue[]): ValidationIssue[] =>
  issues.map((i) => ({ path: formatPath(i.path), message: i.message, source: 'schema' as const }));

const addUsage = (a: Usage, b: Usage): Usage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

export function repairPrompt(schemaName: string, raw: string, issues: ValidationIssue[]): string {
  return [
    `Your previous ${schemaName} output did not pass validation.`,
    '',
    'Problems:',
    ...issues.map((i) => `- ${i.path}: ${i.message}`),
    '',
    'Your previous output:',
    '<previous_output>',
    raw.slice(0, 8000),
    '</previous_output>',
    '',
    `Return the complete, corrected ${schemaName}. Fix only the problems listed; keep every other field exactly as it was.`,
    'Do not invent information that is not in the original input — if a value is unknown, leave the optional field out.',
  ].join('\n');
}

type Check<T> =
  | { ok: true; value: T; fixes: string[] }
  | { ok: false; issues: ValidationIssue[]; fixes: string[]; schemaValid?: T };

function check<T>(json: unknown, args: RunStructuredArgs<T>): Check<T> {
  if (json === undefined) return { ok: false, issues: [{ path: '(root)', message: 'Output was not a JSON object.', source: 'json' }], fixes: [] };
  const fixes: string[] = [];
  let parsed = args.schema.safeParse(json);
  if (!parsed.success) {
    const cleaned = dropNulls(json);
    const retry = args.schema.safeParse(cleaned);
    if (retry.success) {
      parsed = retry;
      fixes.push('dropped null values for optional fields');
    }
  }
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error.issues), fixes };
  const semantic = args.semanticCheck?.(parsed.data) ?? [];
  if (semantic.length > 0) return { ok: false, issues: semantic, fixes, schemaValid: parsed.data };
  return { ok: true, value: parsed.data, fixes };
}

const s = (n: number): string => (n === 1 ? '' : 's');
const secs = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function summarizeTrace(t: Omit<StructuredTrace, 'summary'>): string {
  const repairs = t.attempts.filter((a) => a.kind === 'repair').length;
  switch (t.status) {
    case 'valid':
      return `${t.schemaName} valid on first try · ${secs(t.totalLatencyMs)}`;
    case 'locally_fixed':
      return `${t.schemaName} valid after local fix (${t.localFixes.join(', ')}) · no extra model call`;
    case 'repaired':
      return `Schema repaired ${t.repairedFields.length} field${s(t.repairedFields.length)} (${t.repairedFields.join(', ')}) · ${repairs} repair call${s(repairs)} · ${secs(t.totalLatencyMs)}`;
    case 'invalid': {
      const last = t.attempts[t.attempts.length - 1];
      const n = last?.issues.length ?? 0;
      return `Schema still invalid after ${repairs} repair${s(repairs)} (${n} issue${s(n)}) · not guessing`;
    }
    case 'error':
      return `Model call failed · ${t.attempts[t.attempts.length - 1]?.issues[0]?.message ?? 'unknown error'}`;
  }
}

export async function runStructured<T>(args: RunStructuredArgs<T>): Promise<StructuredOutcome<T>> {
  const clock = args.clock ?? Date.now;
  const maxRepairs = args.maxRepairs ?? 1;
  const jsonSchema = zodToLlmJsonSchema(args.schema);
  const attempts: AttemptTrace[] = [];
  const allFixes: string[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let messages = args.messages;
  let firstIssues: ValidationIssue[] = [];
  let lastRaw = '';
  let schemaValidValue: T | undefined;

  const finish = (status: TraceStatus, repairedFields: string[] = []): StructuredTrace => {
    const base = {
      schemaName: args.schemaName,
      ...(args.label ? { label: args.label } : {}),
      provider: args.llm.id,
      status,
      attempts,
      repairedFields,
      localFixes: [...new Set(allFixes)],
      totalLatencyMs: attempts.reduce((a, x) => a + x.latencyMs, 0),
      usage,
      notes: [],
    };
    return { ...base, summary: summarizeTrace(base) };
  };

  for (let n = 1; n <= maxRepairs + 1; n++) {
    const kind = n === 1 ? 'generate' : 'repair';
    const started = clock();
    let res;
    try {
      res = await args.llm.generateJson({
        system: args.system,
        messages,
        jsonSchema,
        schemaName: args.schemaName,
        ...(args.description ? { description: args.description } : {}),
        ...(args.maxTokens ? { maxTokens: args.maxTokens } : {}),
      });
    } catch (e) {
      const message = e instanceof ProviderError || e instanceof Error ? e.message : String(e);
      const issues: ValidationIssue[] = [{ path: '(root)', message, source: 'provider' }];
      attempts.push({ n, kind, latencyMs: clock() - started, ok: false, issues, localFixes: [], usage: { inputTokens: 0, outputTokens: 0 }, model: args.llm.id, rawPreview: '' });
      return { ok: false, errors: issues, trace: finish('error'), lastRaw };
    }
    lastRaw = res.raw;
    usage = addUsage(usage, res.usage);
    const result = check(res.json, args);
    const fixes = [...res.parseFixes, ...result.fixes];
    allFixes.push(...fixes);
    attempts.push({
      n, kind, latencyMs: clock() - started, ok: result.ok, issues: result.ok ? [] : result.issues,
      localFixes: fixes, usage: res.usage, model: res.model, rawPreview: res.raw.slice(0, 600),
    });
    if (result.ok) {
      if (n === 1) return { ok: true, value: result.value, trace: finish(fixes.length ? 'locally_fixed' : 'valid') };
      const repaired = [...new Set(firstIssues.map((i) => i.path))];
      return { ok: true, value: result.value, trace: finish('repaired', repaired) };
    }
    if (n === 1) firstIssues = result.issues;
    schemaValidValue = result.schemaValid;
    messages = [
      ...args.messages,
      { role: 'assistant', content: res.raw || '(empty output)' },
      { role: 'user', content: repairPrompt(args.schemaName, res.raw, result.issues) },
    ];
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: false, errors: last?.issues ?? [], trace: finish('invalid'), lastRaw,
    ...(schemaValidValue !== undefined ? { schemaValidValue } : {}),
  };
}
