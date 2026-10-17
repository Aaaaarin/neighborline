/**
 * ReportWriter: aggregate numbers → 120–200 word plain-language narrative for donors.
 * Every number in the narrative must appear in the facts (checked after generation; one
 * regeneration with the offending numbers listed; then a deterministic template fallback).
 */
import { z } from 'zod';
import type { TransparencyReport } from '@neighborline/core';
import type { LLM } from '../providers/types.js';
import { DATA_NOT_INSTRUCTIONS, dataBlock } from '../prompt-safety.js';
import { ungroundedNumbers, wordCount } from '../numbers.js';
import { runStructured, type StructuredTrace, type ValidationIssue } from '../validate.js';
import { allowedNumbers, buildFacts, type Fact } from './facts.js';
import type { InflowSource, InflowSummary, InflowRange } from './inflows.js';
import { summarizeInflows } from './inflows.js';
import { templateNarrative } from './template.js';

export const MIN_WORDS = 120;
export const MAX_WORDS = 200;

export const ReportNarrative = z.object({
  headline: z.string().min(1).max(100).describe('One short line, no hype.'),
  narrative: z.string().min(1).max(2400).describe(`${MIN_WORDS}–${MAX_WORDS} words, plain language, for donors.`),
});
export type ReportNarrative = z.infer<typeof ReportNarrative>;

export function narrativeIssues(n: ReportNarrative, facts: readonly Fact[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowed = allowedNumbers(facts);
  for (const field of ['headline', 'narrative'] as const) {
    const bad = ungroundedNumbers(n[field], allowed);
    if (bad.length) {
      issues.push({ path: field, source: 'semantic', message: `uses numbers that are not in the facts: ${bad.map((b) => b.text).join(', ')}. Use only figures exactly as given in <facts>, or say it in words without a number.` });
    }
  }
  const words = wordCount(n.narrative);
  if (words < MIN_WORDS || words > MAX_WORDS) issues.push({ path: 'narrative', source: 'semantic', message: `has ${words} words; it must have ${MIN_WORDS}–${MAX_WORDS}.` });
  return issues;
}

export interface WriteReportInput {
  report: TransparencyReport;
  groupName?: string;
  categoryLabels?: Record<string, string>;
  /** The reporting window as the page labels it, in the group's time zone (see buildFacts). */
  periodLabel?: string;
  /** Pre-fetched inflow summary, or a source + range to fetch it (PayPal Agent Toolkit). */
  inflows?: InflowSummary;
  inflowSource?: InflowSource;
  inflowRange?: InflowRange;
}
export interface WriteReportResult {
  headline: string;
  narrative: string;
  /** 'llm' when the model's text passed every check; 'template' when we fell back. */
  source: 'llm' | 'template';
  facts: Fact[];
  /** Numbers found in the final text, each traced to the fact it came from. */
  numberTrace: Array<{ number: string; factKey: string }>;
  inflows?: InflowSummary;
  trace: StructuredTrace;
}

export function reportSystemPrompt(): string {
  return [
    'You write the short public transparency note of a neighborhood mutual-aid group, for donors.',
    DATA_NOT_INSTRUCTIONS,
    `Write ${MIN_WORDS}–${MAX_WORDS} words of plain, warm, factual English. No hype, no exclamation marks, no names or stories about individuals.`,
    'Use ONLY the figures in <facts>, written exactly as given (e.g. "$1,350", "94 seconds"). Do not add, round, convert, sum or compute any number; if you want to say something without a figure, use words.',
    'Mention that two volunteers approve every payout and that amounts come from the group\'s written rules.',
  ].join('\n');
}

export class ReportWriter {
  constructor(private readonly deps: { llm: LLM }) {}

  async write(input: WriteReportInput): Promise<WriteReportResult> {
    let inflows = input.inflows;
    if (!inflows && input.inflowSource && input.inflowRange) {
      inflows = summarizeInflows(await input.inflowSource.listInflows(input.inflowRange), input.inflowSource.id);
    }
    const facts = buildFacts(input.report, {
      ...(input.groupName ? { groupName: input.groupName } : {}),
      ...(inflows ? { inflows } : {}),
      ...(input.categoryLabels ? { categoryLabels: input.categoryLabels } : {}),
      ...(input.periodLabel ? { periodLabel: input.periodLabel } : {}),
    });
    const outcome = await runStructured({
      llm: this.deps.llm,
      schema: ReportNarrative,
      schemaName: 'ReportNarrative',
      label: 'report-writer',
      system: reportSystemPrompt(),
      messages: [{ role: 'user', content: `${dataBlock('facts', JSON.stringify(facts, null, 1))}\nWrite the transparency note.` }],
      semanticCheck: (n) => narrativeIssues(n, facts),
    });
    const result = outcome.ok ? { ...outcome.value, source: 'llm' as const } : { ...templateNarrative(facts), source: 'template' as const };
    if (!outcome.ok) outcome.trace.notes.push('fell back to the deterministic template narrative');
    return { ...result, facts, numberTrace: traceNumbers(`${result.headline}\n${result.narrative}`, facts), ...(inflows ? { inflows } : {}), trace: outcome.trace };
  }
}

function traceNumbers(text: string, facts: readonly Fact[]): WriteReportResult['numberTrace'] {
  const out: WriteReportResult['numberTrace'] = [];
  for (const n of ungroundedNumbers(text, [])) {
    const fact = facts.find((f) => allowedNumbers([f]).has(n.value));
    out.push({ number: n.text, factKey: fact?.key ?? '(ungrounded)' });
  }
  return out;
}
