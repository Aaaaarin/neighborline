/**
 * Offline (fixture-mode) policy parser for rules written in the house style:
 *   "- Groceries: up to $100 per request, $200 per household in 30 days."
 * Exact demo text maps to the core demo policy (with translations); anything else is parsed
 * line by line. It is a fallback, not a replacement for the LLM compiler.
 */
import { DEMO_POLICY_SOURCE_TEXT, demoPolicy, parseUsdToCents } from '@neighborline/core';
import type { PolicyDraftModel } from './schema.js';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 40) || 'rule';
const usd = (s: string | undefined): number | null => (s ? parseUsdToCents(s) : null);
const WORDS: Record<string, number> = { once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, five: 5 };

export interface KnownCategory {
  key: string;
  label: string;
}

const simple = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/s$/, '');

/** Reuse a previous key when the rule names the same thing ("Medicine co-pays" ~ "Medicine co-pay"). */
function keyFor(names: string[], known: readonly KnownCategory[]): string | undefined {
  for (const n of names) {
    const a = simple(n);
    const hit = known.find((k) => {
      const b = simple(k.label);
      return a === b || a.startsWith(b) || b.startsWith(a) || simple(k.key.replace(/_/g, ' ')) === a;
    });
    if (hit) return hit.key;
  }
  return undefined;
}

export function parsePolicyOffline(sourceText: string, known: readonly KnownCategory[] = []): PolicyDraftModel {
  const lines = sourceText.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  if (norm(sourceText) === norm(DEMO_POLICY_SOURCE_TEXT)) {
    const demo = demoPolicy();
    const quote = (i: number): string => lines.find((l) => l.toLowerCase().startsWith(['power', 'groceries', 'medicine', 'rent', 'transport', 'anything'][i] ?? '')) ?? '';
    return {
      categories: demo.categories.map((c, i) => ({
        key: c.key,
        label: { en: c.label.en ?? c.key, ...c.label },
        maxCents: c.maxCents,
        perHouseholdPer30dCents: c.perHouseholdPer30dCents,
        ...(c.requiresPhoto !== undefined ? { requiresPhoto: c.requiresPhoto } : {}),
        sourceQuote: quote(i),
      })),
      householdCapPer30dCents: demo.householdCapPer30dCents,
      dailyBudgetCents: demo.dailyBudgetCents,
      maxRequestsPerDestinationPer30d: demo.maxRequestsPerDestinationPer30d,
      ambiguities: [],
    };
  }
  const categories: PolicyDraftModel['categories'] = [];
  const ambiguities: string[] = [];
  let household: number | null = null;
  let daily: number | null = null;
  let perDest: number | null = null;
  for (const line of lines) {
    const rule = /^([^:]+):\s*up to (\$[\d,]+(?:\.\d{2})?)(?: per request)?(?:,\s*(?:at most\s*)?(\$[\d,]+(?:\.\d{2})?) per household in 30 days|,\s*once per household in 30 days)?/i.exec(line);
    if (rule) {
      const name = (rule[1] ?? '').trim();
      const paren = /\(([^)]+)\)/.exec(name)?.[1];
      const isOther = /anything else|other/i.test(name);
      const max = usd(rule[2]) ?? 0;
      const bare = name.replace(/\([^)]*\)/, '').trim();
      const knownKey = isOther ? undefined : keyFor([paren ?? '', bare].filter(Boolean), known);
      const labelEn = isOther ? 'Other' : (known.find((k) => k.key === knownKey)?.label ?? (paren && paren.split(' ').length <= 3 ? paren : bare));
      categories.push({
        key: isOther ? 'other' : (knownKey ?? slug(labelEn)),
        label: { en: labelEn.replace(/^\w/, (c) => c.toUpperCase()) },
        maxCents: max,
        perHouseholdPer30dCents: usd(rule[3]) ?? max,
        ...(/photo required|needs? a photo/i.test(line) ? { requiresPhoto: true } : /no photo/i.test(line) ? { requiresPhoto: false } : {}),
        sourceQuote: line,
      });
      continue;
    }
    household ??= usd(/no household gets more than (\$[\d,]+)/i.exec(line)?.[1]);
    daily ??= usd(/at most (\$[\d,]+) per day/i.exec(line)?.[1]);
    const dest = /at most (\w+)(?: times)? in 30 days/i.exec(line)?.[1]?.toLowerCase();
    if (dest && perDest === null) perDest = WORDS[dest] ?? (Number(dest) || null);
  }
  if (household === null) ambiguities.push('No household 30-day cap found; used the largest per-household category cap.');
  if (daily === null) ambiguities.push('No daily budget found; used the largest per-request cap.');
  if (perDest === null) ambiguities.push('No limit on reuse of a payout account found; used 2.');
  const maxHousehold = Math.max(1, ...categories.map((c) => c.perHouseholdPer30dCents));
  return {
    categories,
    householdCapPer30dCents: household ?? maxHousehold,
    dailyBudgetCents: daily ?? Math.max(1, ...categories.map((c) => c.maxCents)),
    maxRequestsPerDestinationPer30d: perDest ?? 2,
    ambiguities,
  };
}
