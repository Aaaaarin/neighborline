/** Deterministic, human-readable diff between two policy versions. No LLM involved. */
import { formatUsd, type PolicyCategory } from '@neighborline/core';
import type { PolicyDraft } from './schema.js';

export interface PolicyChange {
  kind: 'added' | 'removed' | 'changed';
  path: string;
  before?: string;
  after?: string;
  text: string;
}

type Comparable = Pick<PolicyDraft, 'categories' | 'householdCapPer30dCents' | 'dailyBudgetCents' | 'maxRequestsPerDestinationPer30d'>;

const name = (c: PolicyCategory): string => c.label.en ?? c.key;
const describe = (c: PolicyCategory): string =>
  `up to ${formatUsd(c.maxCents)} per request, ${formatUsd(c.perHouseholdPer30dCents)} per household in 30 days${c.requiresPhoto ? ', photo required' : ''}`;

export function diffPolicies(prev: Comparable | null | undefined, next: Comparable): PolicyChange[] {
  if (!prev) {
    return next.categories.map((c) => ({ kind: 'added', path: `categories.${c.key}`, after: describe(c), text: `New rule — ${name(c)}: ${describe(c)}` }));
  }
  const out: PolicyChange[] = [];
  const before = new Map(prev.categories.map((c) => [c.key, c]));
  const after = new Map(next.categories.map((c) => [c.key, c]));
  for (const c of next.categories) {
    const old = before.get(c.key);
    if (!old) {
      out.push({ kind: 'added', path: `categories.${c.key}`, after: describe(c), text: `Added ${name(c)}: ${describe(c)}` });
      continue;
    }
    const money = (field: 'maxCents' | 'perHouseholdPer30dCents', what: string): void => {
      if (old[field] !== c[field]) {
        out.push({ kind: 'changed', path: `categories.${c.key}.${field}`, before: formatUsd(old[field]), after: formatUsd(c[field]), text: `${name(c)}: ${what} ${formatUsd(old[field])} → ${formatUsd(c[field])}` });
      }
    };
    money('maxCents', 'per-request max');
    money('perHouseholdPer30dCents', 'per-household 30-day cap');
    if (!!old.requiresPhoto !== !!c.requiresPhoto) {
      out.push({ kind: 'changed', path: `categories.${c.key}.requiresPhoto`, before: String(!!old.requiresPhoto), after: String(!!c.requiresPhoto), text: `${name(c)}: photo ${c.requiresPhoto ? 'now required' : 'no longer required'}` });
    }
    if ((old.label.en ?? '') !== (c.label.en ?? '')) {
      out.push({ kind: 'changed', path: `categories.${c.key}.label.en`, before: old.label.en ?? '', after: c.label.en ?? '', text: `Renamed "${old.label.en}" → "${c.label.en}"` });
    }
  }
  for (const c of prev.categories) {
    if (!after.has(c.key)) out.push({ kind: 'removed', path: `categories.${c.key}`, before: describe(c), text: `Removed ${name(c)} (was ${describe(c)})` });
  }
  const top = (field: 'householdCapPer30dCents' | 'dailyBudgetCents', what: string): void => {
    if (prev[field] !== next[field]) {
      out.push({ kind: 'changed', path: field, before: formatUsd(prev[field]), after: formatUsd(next[field]), text: `${what}: ${formatUsd(prev[field])} → ${formatUsd(next[field])}` });
    }
  };
  top('householdCapPer30dCents', 'Household cap per 30 days');
  top('dailyBudgetCents', 'Daily budget');
  if (prev.maxRequestsPerDestinationPer30d !== next.maxRequestsPerDestinationPer30d) {
    out.push({
      kind: 'changed', path: 'maxRequestsPerDestinationPer30d',
      before: String(prev.maxRequestsPerDestinationPer30d), after: String(next.maxRequestsPerDestinationPer30d),
      text: `Same payout account, max uses per 30 days: ${prev.maxRequestsPerDestinationPer30d} → ${next.maxRequestsPerDestinationPer30d}`,
    });
  }
  return out;
}
