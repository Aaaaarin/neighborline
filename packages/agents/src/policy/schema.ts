import { z } from 'zod';
import type { Policy } from '@neighborline/core';

/** Policy minus ids/timestamps/approvals/version — what the compiler proposes. */
export type PolicyDraft = Omit<Policy, 'id' | 'groupId' | 'createdAt' | 'approvedBy' | 'version'>;

const label = z.string().min(1).max(60);
/** Fixed language keys instead of a free record: strict structured-output modes need closed objects. */
export const LabelSet = z.object({
  en: label.describe('English label, e.g. "Utility outage".'),
  es: label.optional(), vi: label.optional(), ht: label.optional(), zh: label.optional(), ar: label.optional(),
  fr: label.optional(), tl: label.optional(), ko: label.optional(), ru: label.optional(),
});

export const DraftCategory = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).describe('snake_case key; use "other" for the catch-all rule.'),
  label: LabelSet,
  maxCents: z.number().int().positive().describe('Per-request maximum in integer cents, exactly as the rules state.'),
  perHouseholdPer30dCents: z.number().int().positive().describe('Per-household cap over 30 days in cents. "Once per household" = same as maxCents.'),
  requiresPhoto: z.boolean().optional(),
  sourceQuote: z.string().min(1).max(400).describe('The exact sentence or bullet from the rules this category comes from.'),
});

export const PolicyDraftModel = z.object({
  categories: z.array(DraftCategory).min(1).max(20),
  householdCapPer30dCents: z.number().int().positive(),
  dailyBudgetCents: z.number().int().positive(),
  maxRequestsPerDestinationPer30d: z.number().int().positive().describe('How many times the same payout account may be used in 30 days.'),
  ambiguities: z.array(z.string().max(300)).max(10).describe('Anything in the rules you could not map, or had to interpret. Empty if none.'),
});
export type PolicyDraftModel = z.infer<typeof PolicyDraftModel>;

export function toDraft(m: PolicyDraftModel, sourceText: string): PolicyDraft {
  return {
    sourceText,
    currency: 'USD',
    categories: m.categories.map((c) => {
      const labels: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.label)) if (typeof v === 'string' && v.trim()) labels[k] = v.trim();
      return {
        key: c.key,
        label: labels,
        maxCents: c.maxCents,
        perHouseholdPer30dCents: c.perHouseholdPer30dCents,
        ...(c.requiresPhoto !== undefined ? { requiresPhoto: c.requiresPhoto } : {}),
      };
    }),
    householdCapPer30dCents: m.householdCapPer30dCents,
    dailyBudgetCents: m.dailyBudgetCents,
    maxRequestsPerDestinationPer30d: m.maxRequestsPerDestinationPer30d,
  };
}
