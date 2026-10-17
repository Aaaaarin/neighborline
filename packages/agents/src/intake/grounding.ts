/**
 * Intake checks zod cannot express. Issues returned here go back to the model in the repair call;
 * whatever is still ungrounded afterwards is dropped (and the neighbor is asked) — never guessed.
 */
import { detectPromptInjection, type IntakeExtraction } from '@neighborline/core';
import { extractNumbers, sentenceAt } from '../numbers.js';
import type { ValidationIssue } from '../validate.js';
import { detectAddressForm, isGroundedAddressForm } from './address-form.js';
import { canonicalDestination, detectPayout, isGroundedDestination, unambiguousWrittenPayout, type HandleOptions } from './spoken-handles.js';

type Extraction = Pick<IntakeExtraction, 'payout' | 'requestedAmountCents' | 'missing' | 'householdSize'> & Partial<Pick<IntakeExtraction, 'lang' | 'addressForm'>>;

/** Is this amount said by the person, in a sentence that is not addressed to the system? */
export function isGroundedAmount(cents: number, sourceText: string): boolean {
  const dollars = cents / 100;
  return extractNumbers(sourceText).some(
    (n) => n.value === dollars && detectPromptInjection(sentenceAt(sourceText, n.index)).length === 0,
  );
}

export function intakeSemanticIssues(x: Extraction, sourceText: string, opts: HandleOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (x.payout) {
    const canon = canonicalDestination(x.payout.wallet, x.payout.value, x.payout.type, opts);
    if (!canon) {
      issues.push({ path: 'payout.value', source: 'semantic', message: `"${x.payout.value}" is not a valid ${x.payout.wallet} destination. Use a normalized email, phone, or Venmo username starting with "@".` });
    } else if (!isGroundedDestination(canon.value, sourceText, opts)) {
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
 *
 * A payout the model DID give but that failed grounding is never replaced by one pieced together
 * from spoken fragments (EVAL finding: "@le8575550148" was recovered over a correct
 * "+18575550148"). After a drop, only a destination the person wrote out unambiguously (exactly
 * one written email, @handle or phone number in the text) may take its place; otherwise the
 * neighbor is asked.
 */
export function finalizeExtraction<T extends Extraction>(x: T, sourceText: string, opts: HandleOptions = {}): Finalized<T> {
  const notes: string[] = [];
  const out: T = { ...x };
  const modelGavePayout = Boolean(out.payout);
  if (out.payout) {
    const canon = canonicalDestination(out.payout.wallet, out.payout.value, out.payout.type, opts);
    if (canon && isGroundedDestination(canon.value, sourceText, opts)) {
      if (canon.value !== out.payout.value || canon.type !== out.payout.type) notes.push(`payout normalized: "${out.payout.value}" → ${canon.value}`);
      out.payout = canon;
    } else {
      notes.push(`payout dropped: "${out.payout.value}" is not something the neighbor said`);
      delete out.payout;
    }
  }
  if (!out.payout) {
    // After a drop, only a destination the person wrote out unambiguously; otherwise ask.
    const found = modelGavePayout ? unambiguousWrittenPayout(sourceText, opts) : detectPayout(sourceText, opts);
    if (found) {
      out.payout = found;
      notes.push(`payout recovered from transcript: ${found.wallet} ${found.value}`);
    } else if (modelGavePayout) {
      notes.push('payout not recovered: the transcript does not spell out exactly one destination; asking the neighbor');
    }
  }
  if (out.requestedAmountCents !== undefined && !isGroundedAmount(out.requestedAmountCents, sourceText)) {
    notes.push('requested amount dropped: not stated by the person');
    delete out.requestedAmountCents;
  }
  settleAddressForm(out, sourceText, notes);
  const missing = new Set(out.missing);
  if (out.payout) missing.delete('payout');
  else missing.add('payout');
  if (out.householdSize !== undefined) missing.delete('household');
  out.missing = (['payout', 'category', 'household', 'location'] as const).filter((m) => missing.has(m));
  return { extraction: out, notes };
}

/**
 * Vietnamese address form: the person's own self-introduction wins over the model; a form the words do
 * not back is dropped (the replies fall back to "bạn"); any other language has none.
 */
function settleAddressForm(out: Extraction, sourceText: string, notes: string[]): void {
  if (out.lang !== undefined && out.lang !== 'vi') {
    if (out.addressForm) notes.push(`address form dropped: only used for Vietnamese (lang ${out.lang})`);
    delete out.addressForm;
    return;
  }
  if (out.lang === undefined) return;
  const detected = detectAddressForm(sourceText);
  if (out.addressForm && out.addressForm !== 'bạn' && !isGroundedAddressForm(out.addressForm, sourceText)) {
    notes.push(`address form dropped: "${out.addressForm}" is not how the neighbor spoke`);
    delete out.addressForm;
  }
  if (detected && out.addressForm !== detected && (!out.addressForm || out.addressForm === 'bạn' || detected !== 'bác')) {
    notes.push(`address form from the neighbor's own words: ${detected}${out.addressForm ? ` (model said ${out.addressForm})` : ''}`);
    out.addressForm = detected;
  }
}
