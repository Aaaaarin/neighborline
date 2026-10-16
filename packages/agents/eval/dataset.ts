/**
 * The labeled evaluation set (eval/dataset/*.jsonl). Synthetic: written for this evaluation, not
 * collected from real neighbors. Every line is validated here so a typo in a label fails loudly.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PayoutDestination } from '@neighborline/core';

export const EVAL_LANGS = ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'ko', 'ru', 'fr', 'tl'] as const;
export type EvalLang = (typeof EVAL_LANGS)[number];
export const EVAL_SETS = ['intake', 'adversarial', 'benign'] as const;
export type EvalSet = (typeof EVAL_SETS)[number];
/** Fields scored in `missing` (location is not labeled; see docs/EVAL.md). */
export const SCORED_MISSING = ['payout', 'category', 'household'] as const;

export const DATASET_DIR = fileURLToPath(new URL('./dataset/', import.meta.url));

export const GoldLabels = z
  .object({
    category: z.string().min(1),
    householdSize: z.number().int().min(1).max(30).nullable(),
    payout: PayoutDestination.omit({ nameOnFile: true }).nullable(),
    missing: z.array(z.enum(SCORED_MISSING)),
    status: z.enum(['awaiting_confirmation', 'needs_clarification']),
    /** Only when the person states what their own need costs. */
    requestedAmountCents: z.number().int().positive().optional(),
  })
  .strict();
export type GoldLabels = z.infer<typeof GoldLabels>;

export const EvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    set: z.enum(EVAL_SETS),
    lang: z.enum(EVAL_LANGS),
    /** spoken = written the way a speech-to-text transcript reads; typed = what someone types. */
    input: z.enum(['spoken', 'typed']),
    text: z.string().min(1).max(4000),
    gold: GoldLabels,
    expect: z.object({ injection: z.boolean(), impersonation: z.boolean() }).strict(),
    tags: z.array(z.string()),
    note: z.string().optional(),
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

/** Label rules a line must satisfy beyond its shape. Returns human-readable problems. */
export function caseIssues(c: EvalCase): string[] {
  const out: string[] = [];
  const g = c.gold;
  const has = (m: (typeof SCORED_MISSING)[number]) => g.missing.includes(m);
  if ((g.payout === null) !== has('payout')) out.push(`${c.id}: payout ${g.payout ? 'given' : 'null'} but missing ${has('payout') ? 'has' : 'lacks'} "payout"`);
  if ((g.householdSize === null) !== has('household')) out.push(`${c.id}: householdSize vs missing "household" disagree`);
  if (has('category') && g.category !== 'other') out.push(`${c.id}: an unclear need is labeled category "other"`);
  const clarify = has('payout') || has('category');
  if ((g.status === 'needs_clarification') !== clarify) out.push(`${c.id}: status ${g.status} disagrees with missing [${g.missing.join(', ')}]`);
  if (c.set !== 'adversarial' && (c.expect.injection || c.expect.impersonation)) out.push(`${c.id}: only adversarial cases expect a flag`);
  if (c.set === 'adversarial' && !c.expect.injection && !c.expect.impersonation) out.push(`${c.id}: adversarial case expects no flag`);
  if (c.expect.impersonation && !g.payout) out.push(`${c.id}: an impersonation case needs the destination it imitates as gold payout`);
  return out;
}

export interface LoadedDataset {
  cases: EvalCase[];
  files: string[];
  /** sha256 over the file names and bytes, so a result can be tied to the exact dataset. */
  sha256: string;
}

export function loadDataset(dir: string = DATASET_DIR): LoadedDataset {
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  const hash = createHash('sha256');
  const cases: EvalCase[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf8');
    hash.update(`${f}\n${raw}`);
    raw.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const parsed = EvalCase.safeParse(JSON.parse(line));
      if (!parsed.success) {
        problems.push(`${f}:${i + 1}: ${parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
        return;
      }
      problems.push(...caseIssues(parsed.data));
      cases.push(parsed.data);
    });
  }
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`duplicate id ${c.id}`);
    ids.add(c.id);
  }
  if (problems.length) throw new Error(`eval dataset is invalid:\n${problems.join('\n')}`);
  return { cases, files, sha256: hash.digest('hex') };
}
