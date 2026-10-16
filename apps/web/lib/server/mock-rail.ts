/**
 * Minimal stand-ins for packages/core rail protection + amount computation, so the web app runs
 * before core lands. The integrator replaces these with @neighborline/core functions.
 */
import type { PayoutDestination, RailFlag } from '@neighborline/core';
import type { AmountBreakdown } from '../types';
import { GROUP_HANDLE, ORGANIZERS, POLICY, category, citation } from './fixtures/group';

const CONFUSABLES: Array<[RegExp, string]> = [
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/i/g, 'l'],
  [/rn/g, 'm'],
  [/vv/g, 'w'],
];

export function normalizeHandle(h: string): string {
  let s = h.toLowerCase().replace(/[@._\-\s]/g, '');
  for (const [re, to] of CONFUSABLES) s = s.replace(re, to);
  return s;
}

/** Optimal string alignment (restricted Damerau–Levenshtein). */
export function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i]!;
      const prev = d[i - 1]!;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|prior|above) (rules|instructions)/i,
  /\bapprove\b/i,
  /already authori[sz]ed/i,
  /system prompt/i,
  /group account (has )?changed/i,
];

export function railCheck(input: {
  text: string;
  destination: PayoutDestination | null;
  requestedCents?: number;
  categoryKey: string;
}): RailFlag[] {
  const flags: RailFlag[] = [];
  const dest = input.destination;
  if (dest && dest.type === 'USER_HANDLE') {
    const n = normalizeHandle(dest.value);
    const protectedHandles = [GROUP_HANDLE, ...ORGANIZERS.map((o) => o.handle)];
    for (const h of protectedHandles) {
      const ph = normalizeHandle(h);
      if (n === ph && dest.value.toLowerCase() === h.toLowerCase()) {
        flags.push({ code: 'DEST_IS_GROUP_HANDLE', severity: 'block', detail: `${dest.value} is the group’s own account.` });
      } else if (osaDistance(n, ph) <= 2 || n === ph) {
        flags.push({
          code: 'LOOKALIKE_HANDLE',
          severity: 'block',
          detail: `${dest.value} is one letter away from ${h}, the group’s official account. Payouts to lookalike handles are blocked.`,
        });
      }
    }
  }
  const hits = INJECTION_PATTERNS.filter((re) => re.test(input.text)).length;
  if (hits >= 2) {
    flags.push({
      code: 'PROMPT_INJECTION',
      severity: 'review',
      detail: 'The message contains instructions for the approver (“ignore the previous rules”, “approve”). They were not followed.',
    });
  }
  const cat = category(input.categoryKey);
  if (input.requestedCents && (!cat || input.requestedCents > POLICY.householdCapPer30dCents)) {
    flags.push({
      code: 'CAP_EXCEEDED',
      severity: 'review',
      detail: `Asks for $${input.requestedCents / 100}; no category allows more than $${POLICY.householdCapPer30dCents / 100} a month.`,
    });
  }
  return flags;
}

export function computeAmount(input: {
  categoryKey: string;
  requestedCents?: number;
  householdPaid30dCents: number;
  paidTodayCents: number;
}): { amountCents: number; citation: string; breakdown: AmountBreakdown } | null {
  const cat = category(input.categoryKey);
  if (!cat) return null;
  const householdRemaining = Math.max(
    0,
    Math.min(cat.perHouseholdPer30dCents, POLICY.householdCapPer30dCents) - input.householdPaid30dCents,
  );
  const dailyRemaining = Math.max(0, POLICY.dailyBudgetCents - input.paidTodayCents);
  const candidates: Array<[AmountBreakdown['limitedBy'], number]> = [
    ['category', cat.maxCents],
    ['household', householdRemaining],
    ['daily', dailyRemaining],
  ];
  if (input.requestedCents != null) candidates.unshift(['requested', input.requestedCents]);
  let best = candidates[0]!;
  for (const c of candidates) if (c[1] < best[1]) best = c;
  return {
    amountCents: best[1],
    citation: citation(cat.key),
    breakdown: {
      requestedCents: input.requestedCents ?? null,
      categoryMaxCents: cat.maxCents,
      householdRemainingCents: householdRemaining,
      dailyRemainingCents: dailyRemaining,
      resultCents: best[1],
      limitedBy: best[0],
    },
  };
}
