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

export type LimitField = 'householdCapPer30dCents' | 'dailyBudgetCents' | 'maxRequestsPerDestinationPer30d';

const ruleLines = (text: string): string[] => text.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
const COUNT_WORDS: Readonly<Record<number, string[]>> = { 1: ['once', 'one'], 2: ['twice', 'two'], 3: ['three', 'thrice'], 4: ['four'], 5: ['five'] };

/**
 * Which line of the rules states each group-wide limit: the first line that contains the amount
 * (or count) and is not one of the category rules. Pure string matching, so the review screen can
 * show organizers where every number came from without trusting the model for it.
 */
export function limitQuotes(sourceText: string, d: Pick<PolicyDraft, LimitField>, categoryQuotes: readonly string[] = []): Partial<Record<LimitField, string>> {
  const taken = new Set(categoryQuotes.map(squash));
  const lines = ruleLines(sourceText).filter((l) => !taken.has(squash(l)));
  const hasNumber = (l: string, n: number): boolean => numbersIn(l).includes(n);
  const out: Partial<Record<LimitField, string>> = {};
  const money = (field: 'householdCapPer30dCents' | 'dailyBudgetCents', hint: RegExp): void => {
    const n = d[field] / 100;
    const hit = lines.find((l) => hasNumber(l, n) && hint.test(l)) ?? lines.find((l) => hasNumber(l, n));
    if (hit) out[field] = hit;
  };
  money('householdCapPer30dCents', /household/i);
  money('dailyBudgetCents', /day|daily/i);
  const n = d.maxRequestsPerDestinationPer30d;
  const words = COUNT_WORDS[n] ?? [];
  const mentions = (l: string): boolean => hasNumber(l, n) || words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(l));
  const dest = lines.find((l) => mentions(l) && /account|destination|handle|venmo|paypal/i.test(l));
  if (dest) out.maxRequestsPerDestinationPer30d = dest;
  return out;
}

/** Keep translations a previous version already had for the same rule (same key, same English name). */
function keepTranslations(draft: PolicyDraft, previous: Policy | null | undefined): PolicyDraft {
  if (!previous) return draft;
  const before = new Map(previous.categories.map((c) => [c.key, c]));
  return {
    ...draft,
    categories: draft.categories.map((c) => {
      const old = before.get(c.key);
      return old && old.label.en === c.label.en ? { ...c, label: { ...old.label, ...c.label } } : c;
    }),
  };
}

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
      /** Category key → the sentence of the rules it came from (validated: copied from the text). */
      quotes: Record<string, string>;
      /** Group-wide limits → the line of the rules that states them (found by code, not the model). */
      limitQuotes: Partial<Record<LimitField, string>>;
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
    const draft = keepTranslations(toDraft(outcome.value, sourceText), input.previous);
    const quotes = Object.fromEntries(outcome.value.categories.map((c) => [c.key, c.sourceQuote]));
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
      quotes,
      limitQuotes: limitQuotes(sourceText, draft, Object.values(quotes)),
      warnings,
      status: 'draft',
      requiredApprovals: REQUIRED_APPROVALS,
      trace: outcome.trace,
    };
  }
}
