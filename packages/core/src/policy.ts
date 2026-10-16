/** Policy helpers: lookup, validation (schema + invariants) and the Eastside demo seed policy. */
import { Policy, type PolicyCategory } from './schemas.js';
import { formatUsd } from './money.js';

export const FALLBACK_CATEGORY_KEY = 'other';

export type PolicyIssue = { path: string; message: string };
export type PolicyValidation = { ok: true; policy: Policy } | { ok: false; issues: PolicyIssue[] };

export function findCategory(policy: Policy, key: string): PolicyCategory | undefined {
  return policy.categories.find((c) => c.key === key);
}

/**
 * Resolve the category an extraction maps to. Unknown keys fall back to 'other'
 * (case/whitespace-insensitive match first). Returns undefined only if the policy has no 'other'.
 */
export function resolveCategory(policy: Policy, key: string | undefined | null): PolicyCategory | undefined {
  const k = (key ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return findCategory(policy, k) ?? findCategory(policy, FALLBACK_CATEGORY_KEY);
}

/** Label in the requested language, falling back to English, then the key. */
export function categoryLabel(category: PolicyCategory, lang = 'en'): string {
  return category.label[lang] ?? category.label.en ?? category.key;
}

/** Validate shape (zod) plus business invariants. Never throws. */
export function validatePolicy(input: unknown): PolicyValidation {
  const parsed = Policy.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const p = parsed.data;
  const issues: PolicyIssue[] = [];
  const seen = new Set<string>();
  p.categories.forEach((c, i) => {
    const at = `categories.${i}`;
    if (seen.has(c.key)) issues.push({ path: `${at}.key`, message: `duplicate category key '${c.key}'` });
    seen.add(c.key);
    if (!c.label.en || c.label.en.trim() === '') {
      issues.push({ path: `${at}.label.en`, message: `category '${c.key}' needs an English label` });
    }
    for (const [lang, label] of Object.entries(c.label)) {
      if (label.trim() === '') issues.push({ path: `${at}.label.${lang}`, message: 'label must not be blank' });
    }
    if (c.maxCents > c.perHouseholdPer30dCents) {
      issues.push({
        path: `${at}.maxCents`,
        message: `'${c.key}' per-request max exceeds its per-household 30-day cap`,
      });
    }
    if (c.maxCents > p.householdCapPer30dCents) {
      issues.push({ path: `${at}.maxCents`, message: `'${c.key}' max exceeds the household 30-day cap` });
    }
    if (c.perHouseholdPer30dCents > p.householdCapPer30dCents) {
      issues.push({
        path: `${at}.perHouseholdPer30dCents`,
        message: `'${c.key}' per-household cap exceeds the household 30-day cap`,
      });
    }
    if (c.maxCents > p.dailyBudgetCents) {
      issues.push({ path: `${at}.maxCents`, message: `'${c.key}' max exceeds the daily budget` });
    }
  });
  if (p.householdCapPer30dCents > p.dailyBudgetCents * 30) {
    issues.push({ path: 'householdCapPer30dCents', message: 'household cap exceeds 30 days of budget' });
  }
  return issues.length ? { ok: false, issues } : { ok: true, policy: p };
}

/** Throwing variant for seeds/boot. */
export function assertValidPolicy(input: unknown): Policy {
  const v = validatePolicy(input);
  if (!v.ok) throw new Error(`Invalid policy: ${v.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  return v.policy;
}

/** One-line human description of a category rule, used in citations and organizer UI. */
export function describeCategory(policy: Policy, category: PolicyCategory, lang = 'en'): string {
  return `Policy v${policy.version} · ${categoryLabel(category, lang)} · up to ${formatUsd(category.maxCents)} per request`;
}

type LabelSet = Record<'en' | 'es' | 'vi' | 'ht' | 'zh' | 'ar', string>;
const cat = (
  key: string,
  label: LabelSet,
  maxUsd: number,
  perHouseholdUsd: number,
  requiresPhoto?: boolean,
): PolicyCategory => ({
  key,
  label,
  maxCents: maxUsd * 100,
  perHouseholdPer30dCents: perHouseholdUsd * 100,
  ...(requiresPhoto === undefined ? {} : { requiresPhoto }),
});

export const DEMO_POLICY_SOURCE_TEXT = `Eastside Mutual Aid — rules for quick cash help (v1)
- Power or heat out (utility outage): up to $150 per request, at most $300 per household in 30 days.
- Groceries: up to $100 per request, $200 per household in 30 days.
- Medicine co-pays: up to $120 per request, $240 per household in 30 days.
- Rent gap: up to $250, once per household in 30 days. No photo needed.
- Transport (bus pass, gas, rides to appointments): up to $60 per request, $120 per household in 30 days.
- Anything else: up to $75, once per household in 30 days.
- No household gets more than $400 in any 30 days. We spend at most $2,500 per day.
- The same payout account can be used at most twice in 30 days.
- Every payout needs two organizers to approve.`;

/** Eastside Mutual Aid demo policy v1. Ids are stable so seeds and tests can reference them. */
export function demoPolicy(opts: { id?: string; groupId?: string; createdAt?: string; approvedBy?: string[] } = {}): Policy {
  return assertValidPolicy({
    id: opts.id ?? 'pol_eastside_v1',
    groupId: opts.groupId ?? 'grp_eastside',
    version: 1,
    sourceText: DEMO_POLICY_SOURCE_TEXT,
    currency: 'USD',
    categories: [
      cat('utility_outage', {
        en: 'Utility outage', es: 'Corte de luz o servicios', vi: 'Mất điện / mất tiện ích',
        ht: 'Kouran oswa sèvis koupe', zh: '停电或断水断气', ar: 'انقطاع الخدمات',
      }, 150, 300),
      cat('groceries', {
        en: 'Groceries', es: 'Comida', vi: 'Thực phẩm', ht: 'Manje', zh: '食品杂货', ar: 'مواد غذائية',
      }, 100, 200),
      cat('medicine_copay', {
        en: 'Medicine co-pay', es: 'Copago de medicinas', vi: 'Tiền đồng chi trả thuốc',
        ht: 'Kopeman pou medikaman', zh: '药品自付费用', ar: 'المساهمة في ثمن الدواء',
      }, 120, 240),
      cat('rent_gap', {
        en: 'Rent gap', es: 'Falta para la renta', vi: 'Thiếu tiền thuê nhà',
        ht: 'Mank pou lwaye', zh: '房租缺口', ar: 'عجز في الإيجار',
      }, 250, 250, false),
      cat('transport', {
        en: 'Transport', es: 'Transporte', vi: 'Đi lại', ht: 'Transpò', zh: '交通', ar: 'المواصلات',
      }, 60, 120),
      cat('other', {
        en: 'Other', es: 'Otro', vi: 'Khác', ht: 'Lòt bagay', zh: '其他', ar: 'أخرى',
      }, 75, 75),
    ],
    householdCapPer30dCents: 400_00,
    dailyBudgetCents: 2_500_00,
    maxRequestsPerDestinationPer30d: 2,
    createdAt: opts.createdAt ?? '2026-10-01T15:00:00.000Z',
    approvedBy: opts.approvedBy ?? ['org_dana', 'org_marcus'],
  });
}
