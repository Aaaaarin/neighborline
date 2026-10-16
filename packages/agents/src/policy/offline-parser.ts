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
const WORDS: Record<string, number> = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * Canned translations for a few categories groups commonly add, so a fixture-mode draft still shows
 * neighbors their own language. Live mode asks the LLM for these labels instead.
 */
const FIXTURE_LABELS: Readonly<Record<string, Record<string, string>>> = {
  baby_supplies: { es: 'Artículos para bebé', vi: 'Đồ dùng cho em bé', ht: 'Bagay pou tibebe', zh: '婴儿用品', ar: 'مستلزمات الأطفال' },
  school_supplies: { es: 'Útiles escolares', vi: 'Đồ dùng học tập', ht: 'Founiti lekòl', zh: '学习用品', ar: 'لوازم مدرسية' },
  phone_bill: { es: 'Factura del teléfono', vi: 'Tiền điện thoại', ht: 'Bòdwo telefòn', zh: '电话费', ar: 'فاتورة الهاتف' },
};

const MONEY = String.raw`\$[\d,]+(?:\.\d{2})?`;
/** House style: "Groceries: up to $100 per request, $200 per household in 30 days." */
const RULE = new RegExp(String.raw`^([^:]+):\s*up to (${MONEY})(?: per request)?(?:,\s*(?:at most\s*)?(${MONEY}) per household in 30 days|,\s*once per household in 30 days)?`, 'i');
/** Plain prose: "After the ice storm, we cover up to $150 for power outages, $300 per household in 30 days." */
const PROSE = new RegExp(
  String.raw`\b(?:cover|pay|give|send)s?\s+up to (${MONEY})(?: per request)?\s+(?:for|toward|towards)\s+([^,.;]+?)(?:\s*(?:[,;]|and)\s*(?:at most\s*|up to\s*)?(${MONEY}) per household(?: in (?:any )?30 days)?|\s*,\s*once per household(?: in 30 days)?)?\s*(?:[.;]|$)`,
  'i',
);

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
    const house = RULE.exec(line);
    const prose = house ? null : PROSE.exec(line);
    const rule = house ? { name: house[1] ?? '', max: house[2], cap: house[3] } : prose ? { name: prose[2] ?? '', max: prose[1], cap: prose[3] } : null;
    if (rule) {
      const name = rule.name.trim();
      // "(utility outage)" names the rule; "(diapers, formula, wipes)" lists examples.
      const parenRaw = /\(([^)]+)\)/.exec(name)?.[1];
      const paren = parenRaw && !parenRaw.includes(',') && parenRaw.split(' ').length <= 3 ? parenRaw : undefined;
      const isOther = /anything else|\bother\b|everything else/i.test(name);
      const max = usd(rule.max) ?? 0;
      const bare = name.replace(/\([^)]*\)/, '').trim();
      const knownKey = isOther ? undefined : keyFor([paren ?? '', bare].filter(Boolean), known);
      const labelEn = isOther ? 'Other' : (known.find((k) => k.key === knownKey)?.label ?? paren ?? bare);
      const key = isOther ? 'other' : (knownKey ?? slug(labelEn));
      categories.push({
        key,
        label: { ...(FIXTURE_LABELS[key] ?? {}), en: labelEn.replace(/^\w/, (c) => c.toUpperCase()) },
        maxCents: max,
        perHouseholdPer30dCents: usd(rule.cap) ?? max,
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
