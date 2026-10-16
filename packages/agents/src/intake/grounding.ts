/**
 * Intake checks zod cannot express. Issues returned here go back to the model in the repair call;
 * whatever is still ungrounded afterwards is dropped (and the neighbor is asked) — never guessed.
 */
import { detectPromptInjection, type IntakeExtraction } from '@neighborline/core';
import { extractNumbers, sentenceAt } from '../numbers.js';
import type { ValidationIssue } from '../validate.js';
import { canonicalDestination, detectPayout, isGroundedDestination } from './spoken-handles.js';

type Extraction = Pick<IntakeExtraction, 'payout' | 'requestedAmountCents' | 'missing' | 'householdSize'>;

/** Is this amount said by the person, in a sentence that is not addressed to the system? */
export function isGroundedAmount(cents: number, sourceText: string): boolean {
  const dollars = cents / 100;
  return extractNumbers(sourceText).some(
    (n) => n.value === dollars && detectPromptInjection(sentenceAt(sourceText, n.index)).length === 0,
  );
}

export function intakeSemanticIssues(x: Extraction, sourceText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (x.payout) {
    if (!canonicalDestination(x.payout.wallet, x.payout.value, x.payout.type)) {
      issues.push({ path: 'payout.value', source: 'semantic', message: `"${x.payout.value}" is not a valid ${x.payout.wallet} destination. Use a normalized email, phone, or Venmo username starting with "@".` });
    } else if (!isGroundedDestination(x.payout.value, sourceText)) {
      issues.push({ path: 'payout.value', source: 'semantic', message: `"${x.payout.value}" does not appear in what the neighbor said. Use exactly what they said (normalized) or omit payout and add "payout" to missing.` });
    }
  }
  if (x.requestedAmountCents !== undefined && !isGroundedAmount(x.requestedAmountCents, sourceText)) {
    issues.push({ path: 'requestedAmountCents', source: 'semantic', message: 'This amount is not stated by the person as the cost of their need. Omit requestedAmountCents.' });
  }
  return issues;
}

export interface Finalized<T> {
  extraction: T;
  notes: string[];
}

/**
 * Deterministic post-processing after validation: canonicalize the payout, drop anything still
 * ungrounded, recover a payout the model missed, and recompute `missing`.
 */
export function finalizeExtraction<T extends Extraction>(x: T, sourceText: string): Finalized<T> {
  const notes: string[] = [];
  const out: T = { ...x };
  if (out.payout) {
    const canon = canonicalDestination(out.payout.wallet, out.payout.value, out.payout.type);
    if (canon && isGroundedDestination(canon.value, sourceText)) {
      if (canon.value !== out.payout.value || canon.type !== out.payout.type) notes.push(`payout normalized: "${out.payout.value}" → ${canon.value}`);
      out.payout = canon;
    } else {
      notes.push(`payout dropped: "${out.payout.value}" is not something the neighbor said`);
      delete out.payout;
    }
  }
  if (!out.payout) {
    const found = detectPayout(sourceText);
    if (found) {
      out.payout = found;
      notes.push(`payout recovered from transcript: ${found.wallet} ${found.value}`);
    }
  }
  if (out.requestedAmountCents !== undefined && !isGroundedAmount(out.requestedAmountCents, sourceText)) {
    notes.push('requested amount dropped: not stated by the person');
    delete out.requestedAmountCents;
  }
  const missing = new Set(out.missing);
  if (out.payout) missing.delete('payout');
  else missing.add('payout');
  if (out.householdSize !== undefined) missing.delete('household');
  out.missing = (['payout', 'category', 'household', 'location'] as const).filter((m) => missing.has(m));
  return { extraction: out, notes };
}
