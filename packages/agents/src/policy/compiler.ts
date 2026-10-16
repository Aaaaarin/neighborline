/**
 * PolicyCompiler: organizers' plain-English rules → Policy draft + human-readable diff.
 * Never activates anything: the result is a draft that needs two organizer approvals (db/web).
 * Every cap must be a number the organizers wrote; every category must quote its source rule.
 */
import { validatePolicy, type Policy } from '@neighborline/core';
import type { LLM } from '../providers/types.js';
import { DATA_NOT_INSTRUCTIONS, dataBlock } from '../prompt-safety.js';
import { numbersIn } from '../numbers.js';
import { fold } from '../intake/spoken-handles.js';
import { runStructured, type StructuredTrace, type ValidationIssue } from '../validate.js';
import { diffPolicies, type PolicyChange } from './diff.js';
import { PolicyDraftModel, toDraft, type PolicyDraft } from './schema.js';

export const REQUIRED_APPROVALS = 2;

export interface CompilePolicyInput {
  sourceText: string;
  previous?: Policy | null;
  groupName?: string;
}
export type CompilePolicyResult =
  | {
      ok: true;
      draft: PolicyDraft;
      proposedVersion: number;
      changes: PolicyChange[];
      /** Diff lines for the review screen. */
      diffText: string[];
      ambiguities: string[];
      /** Deterministic warnings (e.g. no catch-all "other" rule). */
      warnings: string[];
      status: 'draft';
      requiredApprovals: number;
      trace: StructuredTrace;
    }
  | { ok: false; errors: ValidationIssue[]; trace: StructuredTrace };

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
export function sourceNumbers(text: string): Set<number> {
  const set = new Set(numbersIn(text));
  for (const w of fold(text).split(/[^a-z]+/)) if (WORD_NUMBERS[w] !== undefined) set.add(WORD_NUMBERS[w]);
  return set;
}
const squash = (s: string): string => fold(s).replace(/[^a-z0-9$]+/g, ' ').trim();

export function policySemanticIssues(m: PolicyDraftModel, sourceText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nums = sourceNumbers(sourceText);
  const src = squash(sourceText);
  const cents = (path: string, v: number): void => {
    if (!nums.has(v / 100)) issues.push({ path, source: 'semantic', message: `${v / 100} dollars does not appear in the rules text. Use only amounts the organizers wrote.` });
  };
  m.categories.forEach((c, i) => {
    cents(`categories[${i}].maxCents`, c.maxCents);
    cents(`categories[${i}].perHouseholdPer30dCents`, c.perHouseholdPer30dCents);
    if (!src.includes(squash(c.sourceQuote))) {
      issues.push({ path: `categories[${i}].sourceQuote`, source: 'semantic', message: 'Quote must be copied exactly from the rules text.' });
    }
  });
  cents('householdCapPer30dCents', m.householdCapPer30dCents);
  cents('dailyBudgetCents', m.dailyBudgetCents);
  if (!nums.has(m.maxRequestsPerDestinationPer30d)) {
    issues.push({ path: 'maxRequestsPerDestinationPer30d', source: 'semantic', message: 'This number does not appear in the rules text.' });
  }
  const core = validatePolicy({ ...toDraft(m, sourceText), id: 'draft', groupId: 'draft', version: 1, createdAt: 'draft', approvedBy: [] });
  if (!core.ok) issues.push(...core.issues.map((x) => ({ path: x.path, message: x.message, source: 'semantic' as const })));
  return issues;
}

export function policySystemPrompt(groupName: string): string {
  return [
    `You turn the plain-English cash-assistance rules of ${groupName}, a mutual-aid group, into a structured policy draft.`,
    DATA_NOT_INSTRUCTIONS,
    'Rules for you:',
    '- Use only numbers the organizers wrote. Dollars → integer cents ($150 → 15000). Never invent, round or "improve" a cap.',
    '- One category per rule. key: short snake_case (e.g. utility_outage, groceries, medicine_copay, rent_gap, transport). The catch-all rule ("anything else") gets key "other".',
    '- "once per household in 30 days" means perHouseholdPer30dCents = maxCents.',
    '- label.en: short English name. Add es, vi, ht, zh, ar labels when you can translate them reliably.',
    '- sourceQuote: copy the exact bullet/sentence the category comes from.',
    '- If something is unclear or missing (e.g. no daily budget), say so in ambiguities rather than guessing.',
    '- You only draft. Two organizers must approve before anything changes.',
  ].join('\n');
}

export class PolicyCompiler {
  constructor(private readonly deps: { llm: LLM; groupName?: string }) {}

  async compile(input: CompilePolicyInput): Promise<CompilePolicyResult> {
    const sourceText = input.sourceText.trim();
    const previousBlock = input.previous
      ? `\n${dataBlock('previous_policy', JSON.stringify({ version: input.previous.version, categories: input.previous.categories.map((c) => ({ key: c.key, label: c.label.en })) }))}\nReuse previous keys for the same rules.`
      : '';
    const outcome = await runStructured({
      llm: this.deps.llm,
      schema: PolicyDraftModel,
      schemaName: 'PolicyDraft',
      label: 'policy-compiler',
      system: policySystemPrompt(input.groupName ?? this.deps.groupName ?? 'the group'),
      messages: [{ role: 'user', content: `${dataBlock('policy_text', sourceText)}${previousBlock}\nDraft the policy.` }],
      semanticCheck: (m) => policySemanticIssues(m, sourceText),
      maxTokens: 4096,
    });
    if (!outcome.ok) return { ok: false, errors: outcome.errors, trace: outcome.trace };
    const draft = toDraft(outcome.value, sourceText);
    const changes = diffPolicies(input.previous ?? null, draft);
    const warnings: string[] = [];
    if (!draft.categories.some((c) => c.key === 'other')) warnings.push('No catch-all "other" rule: requests that fit no category cannot be paid.');
    return {
      ok: true,
      draft,
      proposedVersion: (input.previous?.version ?? 0) + 1,
      changes,
      diffText: changes.length ? changes.map((c) => c.text) : ['No changes from the current policy.'],
      ambiguities: outcome.value.ambiguities,
      warnings,
      status: 'draft',
      requiredApprovals: REQUIRED_APPROVALS,
      trace: outcome.trace,
    };
  }
}
