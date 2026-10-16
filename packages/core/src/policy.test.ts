import { describe, expect, it } from 'vitest';
import {
  assertValidPolicy,
  categoryLabel,
  demoPolicy,
  describeCategory,
  findCategory,
  resolveCategory,
  validatePolicy,
} from './policy.js';
import { formatUsd, parseUsdToCents, toPayPalValue } from './money.js';
import type { Policy } from './schemas.js';

const clone = (): Policy => structuredClone(demoPolicy());

describe('demoPolicy (Eastside Mutual Aid v1)', () => {
  const p = demoPolicy();
  it('is valid and has the six categories with the agreed caps', () => {
    expect(validatePolicy(p).ok).toBe(true);
    const caps = Object.fromEntries(p.categories.map((c) => [c.key, [c.maxCents, c.perHouseholdPer30dCents]]));
    expect(caps).toEqual({
      utility_outage: [15000, 30000],
      groceries: [10000, 20000],
      medicine_copay: [12000, 24000],
      rent_gap: [25000, 25000],
      transport: [6000, 12000],
      other: [7500, 7500],
    });
    expect(p.householdCapPer30dCents).toBe(40000);
    expect(p.dailyBudgetCents).toBe(250000);
    expect(p.maxRequestsPerDestinationPer30d).toBe(2);
    expect(findCategory(p, 'rent_gap')?.requiresPhoto).toBe(false);
  });
  it('labels every category in en, es, vi, ht, zh, ar', () => {
    for (const c of p.categories) {
      expect(Object.keys(c.label).sort()).toEqual(['ar', 'en', 'es', 'ht', 'vi', 'zh']);
      for (const v of Object.values(c.label)) expect(v.trim().length).toBeGreaterThan(0);
    }
  });
  it('uses integer cents everywhere', () => {
    for (const c of p.categories) {
      expect(Number.isInteger(c.maxCents)).toBe(true);
      expect(Number.isInteger(c.perHouseholdPer30dCents)).toBe(true);
    }
  });
  it('accepts overrides for ids', () => {
    const q = demoPolicy({ id: 'x', groupId: 'g', approvedBy: ['a', 'b'], createdAt: '2026-01-01T00:00:00Z' });
    expect([q.id, q.groupId, q.approvedBy, q.createdAt]).toEqual(['x', 'g', ['a', 'b'], '2026-01-01T00:00:00Z']);
  });
});

describe('category lookup', () => {
  const p = demoPolicy();
  it('finds exact keys', () => expect(findCategory(p, 'groceries')?.maxCents).toBe(10000));
  it('returns undefined for unknown keys in findCategory', () => expect(findCategory(p, 'yacht')).toBeUndefined());
  it('resolves loose spellings and falls back to other', () => {
    expect(resolveCategory(p, ' Utility-Outage ')?.key).toBe('utility_outage');
    expect(resolveCategory(p, 'medicine copay')?.key).toBe('medicine_copay');
    expect(resolveCategory(p, 'yacht')?.key).toBe('other');
    expect(resolveCategory(p, undefined)?.key).toBe('other');
    expect(resolveCategory(p, null)?.key).toBe('other');
  });
  it('returns undefined when there is no other category', () => {
    const q = clone();
    q.categories = q.categories.filter((c) => c.key !== 'other');
    expect(resolveCategory(q, 'yacht')).toBeUndefined();
  });
  it('labels fall back to English then key', () => {
    const c = findCategory(p, 'groceries')!;
    expect(categoryLabel(c, 'vi')).toBe('Thực phẩm');
    expect(categoryLabel(c, 'ko')).toBe('Groceries');
    expect(categoryLabel({ ...c, label: {} })).toBe('groceries');
  });
  it('describes a category as a rule citation', () => {
    expect(describeCategory(p, findCategory(p, 'utility_outage')!)).toBe('Policy v1 · Utility outage · up to $150 per request');
  });
});

describe('validatePolicy', () => {
  it('rejects schema violations with paths', () => {
    const r = validatePolicy({ ...clone(), categories: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe('categories');
  });
  it('rejects non-integer cents and bad keys', () => {
    const q = clone();
    q.categories[0]!.maxCents = 150.5;
    q.categories[1]!.key = 'Groceries!';
    const r = validatePolicy(q);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['categories.0.maxCents', 'categories.1.key']));
  });
  it('rejects duplicate category keys', () => {
    const q = clone();
    q.categories.push({ ...q.categories[0]! });
    const r = validatePolicy(q);
    expect(!r.ok && r.issues.some((i) => i.message.includes('duplicate'))).toBe(true);
  });
  it('requires an English label', () => {
    const q = clone();
    q.categories[0]!.label = { es: 'Comida' };
    const r = validatePolicy(q);
    expect(!r.ok && r.issues.some((i) => i.path === 'categories.0.label.en')).toBe(true);
  });
  it('rejects blank labels in any language', () => {
    const q = clone();
    q.categories[0]!.label = { ...q.categories[0]!.label, vi: '  ' };
    const r = validatePolicy(q);
    expect(!r.ok && r.issues.some((i) => i.path === 'categories.0.label.vi')).toBe(true);
  });
  it('rejects category max above household cap, its own per-household cap, or daily budget', () => {
    const q = clone();
    q.categories[0]!.maxCents = 500_00;
    q.categories[0]!.perHouseholdPer30dCents = 500_00;
    const r = validatePolicy(q);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msgs = r.issues.map((i) => i.message).join('|');
      expect(msgs).toContain('max exceeds the household 30-day cap');
      expect(msgs).toContain('per-household cap exceeds the household 30-day cap');
    }
    const q2 = clone();
    q2.categories[1]!.maxCents = 250_00; // groceries per-household is 200
    expect(validatePolicy(q2).ok).toBe(false);
    const q3 = clone();
    q3.dailyBudgetCents = 100_00;
    const r3 = validatePolicy(q3);
    expect(!r3.ok && r3.issues.some((i) => i.message.includes('daily budget'))).toBe(true);
  });
  it('rejects a household cap bigger than 30 days of budget', () => {
    const q = clone();
    q.dailyBudgetCents = 250_00;
    q.householdCapPer30dCents = 400_00;
    q.categories = q.categories.map((c) => ({ ...c, maxCents: Math.min(c.maxCents, 250_00) }));
    expect(validatePolicy(q).ok).toBe(true);
    q.householdCapPer30dCents = 250_00 * 30 + 1;
    expect(validatePolicy(q).ok).toBe(false);
  });
  it('assertValidPolicy throws a readable error', () => {
    expect(() => assertValidPolicy({})).toThrow(/Invalid policy/);
  });
  it('never throws on garbage', () => {
    for (const g of [null, undefined, 42, 'x', [], { categories: 'no' }]) expect(validatePolicy(g).ok).toBe(false);
  });
});

describe('money', () => {
  it('formats USD for people', () => {
    expect(formatUsd(15000)).toBe('$150');
    expect(formatUsd(15050)).toBe('$150.50');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(250000)).toBe('$2,500');
    expect(formatUsd(-1234)).toBe('-$12.34');
    expect(formatUsd(0)).toBe('$0');
  });
  it('formats PayPal values', () => {
    expect(toPayPalValue(15000)).toBe('150.00');
    expect(toPayPalValue(7)).toBe('0.07');
    expect(() => toPayPalValue(-1)).toThrow();
    expect(() => toPayPalValue(1.5)).toThrow(/integer cents/);
  });
  it('parses USD strings into cents', () => {
    expect(parseUsdToCents('150')).toBe(15000);
    expect(parseUsdToCents('$1,500.5')).toBe(150050);
    expect(parseUsdToCents(' 0.07 ')).toBe(7);
    expect(parseUsdToCents('1.234')).toBeNull();
    expect(parseUsdToCents('abc')).toBeNull();
    expect(parseUsdToCents('-5')).toBeNull();
  });
});
