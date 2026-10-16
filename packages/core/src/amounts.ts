/**
 * Amount computation — SPEC §4. Pure, integer cents, never from the LLM.
 *   amount = min(requested ?? category.max, category.max, household 30d remaining,
 *                category-per-household 30d remaining, daily budget remaining)
 */
import type {
  ComputedAmount,
  HistoryEntry,
  IntakeExtraction,
  PayoutDestination,
  Policy,
  RailFlag,
} from './schemas.js';
import { FALLBACK_CATEGORY_KEY, categoryLabel, describeCategory, resolveCategory } from './policy.js';
import { householdWindow, toDate } from './identity.js';
import { formatUsd } from './money.js';

export type LimitKind = NonNullable<ComputedAmount['limitedBy']>;

export interface ComputeAmountInput {
  policy: Policy;
  extraction: Pick<IntakeExtraction, 'category' | 'requestedAmountCents'>;
  history: readonly HistoryEntry[];
  /** Cents already committed today across the whole group (caller computes in group's timezone). */
  todaySpentCents: number;
  destination: PayoutDestination | null;
  phone?: string | undefined;
  /** Evaluation time; defaults to now. */
  now?: string | Date;
  /** When recomputing an existing request, exclude it from its own history. */
  requestId?: string;
}

export type ComputeAmountResult =
  | { ok: true; computed: ComputedAmount }
  | { ok: false; flags: RailFlag[] };

const sum = (xs: readonly HistoryEntry[]): number => xs.reduce((a, h) => a + h.amountCents, 0);

export function computeAmount(input: ComputeAmountInput): ComputeAmountResult {
  const { policy, extraction } = input;
  const category = resolveCategory(policy, extraction.category);
  if (!category) {
    return {
      ok: false,
      flags: [{
        code: 'CAP_EXCEEDED',
        severity: 'review',
        detail: `Category '${extraction.category}' is not in policy v${policy.version} and there is no '${FALLBACK_CATEGORY_KEY}' category`,
      }],
    };
  }
  const todaySpent = Math.max(0, Math.trunc(input.todaySpentCents));
  const now = toDate(input.now);
  const window = householdWindow(input.history, { destination: input.destination, phone: input.phone }, now, {
    excludeRequestId: input.requestId,
  });
  const householdUsed = sum(window);
  const categoryUsed = sum(window.filter((h) => h.ruleKey === category.key));

  const requested = extraction.requestedAmountCents;
  const hasRequest = requested !== undefined && Number.isInteger(requested) && requested > 0;
  const limits: Array<[LimitKind, number]> = [
    ['requested', hasRequest ? requested : Number.POSITIVE_INFINITY],
    ['category_max', category.maxCents],
    ['category_household_cap', Math.max(0, category.perHouseholdPer30dCents - categoryUsed)],
    ['household_cap', Math.max(0, policy.householdCapPer30dCents - householdUsed)],
    ['daily_budget', Math.max(0, policy.dailyBudgetCents - todaySpent)],
  ];
  let [limitedBy, amount] = limits[0] as [LimitKind, number];
  for (const [kind, value] of limits) {
    if (value < amount) [limitedBy, amount] = [kind, value];
  }

  const label = categoryLabel(category);
  if (amount <= 0) {
    const flags: RailFlag[] = [];
    if (limitedBy === 'daily_budget') {
      flags.push({
        code: 'BUDGET_EXCEEDED',
        severity: 'block',
        detail: `Today's budget of ${formatUsd(policy.dailyBudgetCents)} is fully committed; it resets tomorrow`,
      });
    } else if (limitedBy === 'household_cap') {
      flags.push({
        code: 'CAP_EXCEEDED',
        severity: 'block',
        detail: `This payout account already received ${formatUsd(householdUsed)} of the ${formatUsd(policy.householdCapPer30dCents)} 30-day household limit`,
      });
    } else {
      flags.push({
        code: 'CAP_EXCEEDED',
        severity: 'block',
        detail: `${label}: ${formatUsd(categoryUsed)} of ${formatUsd(category.perHouseholdPer30dCents)} per household in 30 days already used`,
      });
    }
    return { ok: false, flags };
  }

  let citation = describeCategory(policy, category);
  const requestedKey = (extraction.category ?? '').trim().toLowerCase();
  if (category.key === FALLBACK_CATEGORY_KEY && requestedKey !== FALLBACK_CATEGORY_KEY) {
    citation += ` (filed as ${label})`;
  }
  switch (limitedBy) {
    case 'category_household_cap':
      citation += ` · ${formatUsd(amount)} left of ${formatUsd(category.perHouseholdPer30dCents)} per household in 30 days`;
      break;
    case 'household_cap':
      citation += ` · ${formatUsd(amount)} left of ${formatUsd(policy.householdCapPer30dCents)} household 30-day limit`;
      break;
    case 'daily_budget':
      citation += ` · ${formatUsd(amount)} left in today's budget`;
      break;
    case 'requested':
      citation += ` · ${formatUsd(amount)} requested`;
      break;
    case 'category_max':
      break;
  }
  return {
    ok: true,
    computed: { amountCents: amount, ruleKey: category.key, ruleCitation: citation, policyVersion: policy.version, limitedBy },
  };
}
