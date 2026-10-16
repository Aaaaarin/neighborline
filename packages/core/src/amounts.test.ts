import { describe, expect, it } from 'vitest';
import { computeAmount, type ComputeAmountInput } from './amounts.js';
import { demoPolicy } from './policy.js';
import { NOW, daysAgo, hist, paypal, venmo } from './test-helpers.js';
import { destinationKey, householdWindow, normalizePhone, sameHousehold, toDate } from './identity.js';

const policy = demoPolicy();
const lan = venmo('@lan-nguyen', 'Nguyen Thi Lan');

const base = (over: Partial<ComputeAmountInput> = {}): ComputeAmountInput => ({
  policy,
  extraction: { category: 'utility_outage' },
  history: [],
  todaySpentCents: 0,
  destination: lan,
  now: NOW,
  ...over,
});

const ok = (input: ComputeAmountInput) => {
  const r = computeAmount(input);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.flags)}`);
  return r.computed;
};

describe('computeAmount — happy path', () => {
  it('defaults to the category max with a clear citation (hero story)', () => {
    const c = ok(base());
    expect(c).toEqual({
      amountCents: 15000,
      ruleKey: 'utility_outage',
      ruleCitation: 'Policy v1 · Utility outage · up to $150 per request',
      policyVersion: 1,
      limitedBy: 'category_max',
    });
  });
  it('uses the requested amount when lower', () => {
    const c = ok(base({ extraction: { category: 'groceries', requestedAmountCents: 4250 } }));
    expect(c.amountCents).toBe(4250);
    expect(c.limitedBy).toBe('requested');
    expect(c.ruleCitation).toBe('Policy v1 · Groceries · up to $100 per request · $42.50 requested');
  });
  it('caps a higher request at the category max (never trusts the LLM)', () => {
    const c = ok(base({ extraction: { category: 'groceries', requestedAmountCents: 9_999_00 } }));
    expect(c.amountCents).toBe(10000);
    expect(c.limitedBy).toBe('category_max');
  });
  it('treats a request equal to the max as the requested amount (tie → requested)', () => {
    expect(ok(base({ extraction: { category: 'groceries', requestedAmountCents: 10000 } })).limitedBy).toBe('requested');
  });
  it('ignores zero, negative and fractional requests', () => {
    for (const r of [0, -500, 12.5]) {
      expect(ok(base({ extraction: { category: 'groceries', requestedAmountCents: r } })).amountCents).toBe(10000);
    }
  });
  it('maps unknown categories to other and says so', () => {
    const c = ok(base({ extraction: { category: 'concert_tickets' } }));
    expect(c.ruleKey).toBe('other');
    expect(c.amountCents).toBe(7500);
    expect(c.ruleCitation).toBe('Policy v1 · Other · up to $75 per request (filed as Other)');
  });
  it('does not add "filed as" when the category really is other', () => {
    expect(ok(base({ extraction: { category: 'other' } })).ruleCitation).not.toContain('filed as');
  });
  it('works without a destination (no household history can match)', () => {
    const c = ok(base({ destination: null, history: [hist({ destination: lan, amountCents: 40000 })] }));
    expect(c.amountCents).toBe(15000);
  });
  it('always returns integer cents', () => {
    const c = ok(base({ todaySpentCents: 2_500_00 - 3333 }));
    expect(Number.isInteger(c.amountCents)).toBe(true);
    expect(c.amountCents).toBe(3333);
  });
});

describe('computeAmount — caps', () => {
  it('applies the per-category household cap', () => {
    const history = [hist({ destination: lan, ruleKey: 'utility_outage', amountCents: 20000 })];
    const c = ok(base({ history }));
    expect(c.amountCents).toBe(10000);
    expect(c.limitedBy).toBe('category_household_cap');
    expect(c.ruleCitation).toBe('Policy v1 · Utility outage · up to $150 per request · $100 left of $300 per household in 30 days');
  });
  it('applies the household 30-day cap across categories', () => {
    const history = [
      hist({ destination: lan, ruleKey: 'rent_gap', amountCents: 25000 }),
      hist({ destination: lan, ruleKey: 'groceries', amountCents: 10000 }),
    ];
    const c = ok(base({ history }));
    expect(c.amountCents).toBe(5000);
    expect(c.limitedBy).toBe('household_cap');
    expect(c.ruleCitation).toContain('$50 left of $400 household 30-day limit');
  });
  it('applies the daily budget', () => {
    const c = ok(base({ todaySpentCents: 2_450_00 }));
    expect(c.amountCents).toBe(5000);
    expect(c.limitedBy).toBe('daily_budget');
    expect(c.ruleCitation).toContain("$50 left in today's budget");
  });
  it('blocks with CAP_EXCEEDED when the household cap is used up', () => {
    const history = [
      hist({ destination: lan, ruleKey: 'rent_gap', amountCents: 25000 }),
      hist({ destination: lan, ruleKey: 'groceries', amountCents: 15000 }),
    ];
    const r = computeAmount(base({ history }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.flags).toHaveLength(1);
      expect(r.flags[0]).toMatchObject({ code: 'CAP_EXCEEDED', severity: 'block' });
      expect(r.flags[0]!.detail).toContain('$400');
    }
  });
  it('blocks with CAP_EXCEEDED when the category cap is used up', () => {
    const history = [hist({ destination: lan, ruleKey: 'other', amountCents: 7500 })];
    const r = computeAmount(base({ extraction: { category: 'other' }, history }));
    expect(!r.ok && r.flags[0]?.code).toBe('CAP_EXCEEDED');
    expect(!r.ok && r.flags[0]?.detail).toContain('Other');
  });
  it('blocks with BUDGET_EXCEEDED when the day is fully committed', () => {
    const r = computeAmount(base({ todaySpentCents: 2_600_00 }));
    expect(!r.ok && r.flags[0]).toMatchObject({ code: 'BUDGET_EXCEEDED', severity: 'block' });
  });
  it('treats negative todaySpent as zero', () => {
    expect(ok(base({ todaySpentCents: -100 })).amountCents).toBe(15000);
  });
  it('flags for review when no category resolves', () => {
    const p = { ...policy, categories: policy.categories.filter((c) => c.key !== 'other') };
    const r = computeAmount(base({ policy: p, extraction: { category: 'yacht' } }));
    expect(!r.ok && r.flags[0]).toMatchObject({ code: 'CAP_EXCEEDED', severity: 'review' });
  });
});

describe('computeAmount — household identity and history window', () => {
  it('matches the household by normalized destination (case, @, whitespace)', () => {
    const history = [hist({ destination: venmo('  @LAN-Nguyen '), ruleKey: 'utility_outage', amountCents: 30000 })];
    expect(computeAmount(base({ history })).ok).toBe(false);
  });
  it('matches the same email across PayPal and Venmo wallets', () => {
    const email = { ...paypal('lan@example.com'), wallet: 'VENMO' as const };
    const history = [hist({ destination: paypal('LAN@example.com'), ruleKey: 'utility_outage', amountCents: 30000 })];
    expect(computeAmount(base({ destination: email, history })).ok).toBe(false);
  });
  it('matches by phone when given on both sides', () => {
    const history = [hist({ destination: venmo('@other'), phone: '+1 (555) 010-2000', ruleKey: 'utility_outage', amountCents: 30000 })];
    expect(computeAmount(base({ history, phone: '555-010-2000' })).ok).toBe(false);
    expect(computeAmount(base({ history })).ok).toBe(true);
  });
  it('ignores other households', () => {
    const history = [hist({ destination: venmo('@someone-else'), ruleKey: 'utility_outage', amountCents: 30000 })];
    expect(ok(base({ history })).amountCents).toBe(15000);
  });
  it('ignores entries older than 30 days and in the future', () => {
    const history = [
      hist({ destination: lan, ruleKey: 'utility_outage', amountCents: 30000, createdAt: daysAgo(31) }),
      hist({ destination: lan, ruleKey: 'utility_outage', amountCents: 30000, createdAt: daysAgo(-1) }),
      hist({ destination: lan, ruleKey: 'utility_outage', amountCents: 30000, createdAt: 'not a date' }),
    ];
    expect(ok(base({ history })).amountCents).toBe(15000);
  });
  it('counts an entry 29.9 days old', () => {
    const history = [hist({ destination: lan, ruleKey: 'utility_outage', amountCents: 30000, createdAt: daysAgo(29.9) })];
    expect(computeAmount(base({ history })).ok).toBe(false);
  });
  it('ignores declined, cancelled, returned and failed requests (no money went out)', () => {
    const history = (['declined', 'cancelled', 'returned', 'failed', 'intake', 'needs_clarification'] as const).map((status) =>
      hist({ destination: lan, ruleKey: 'utility_outage', amountCents: 30000, status }),
    );
    expect(ok(base({ history })).amountCents).toBe(15000);
  });
  it('counts awaiting_approval/approved/paying/unclaimed as committed', () => {
    for (const status of ['awaiting_approval', 'approved', 'paying', 'unclaimed', 'paid'] as const) {
      const history = [hist({ destination: lan, ruleKey: 'utility_outage', amountCents: 30000, status })];
      expect(computeAmount(base({ history })).ok).toBe(false);
    }
  });
  it('excludes the request itself when recomputing', () => {
    const history = [hist({ requestId: 'req_self', destination: lan, ruleKey: 'utility_outage', amountCents: 15000, status: 'awaiting_approval' })];
    expect(ok(base({ history, requestId: 'req_self' })).amountCents).toBe(15000);
    expect(ok(base({ history })).amountCents).toBe(15000); // 300 - 150 = 150 still
  });
  it('defaults now to the current time', () => {
    const { now: _n, ...rest } = base();
    expect(computeAmount(rest).ok).toBe(true);
  });
});

describe('identity helpers', () => {
  it('normalizes phones', () => {
    expect(normalizePhone('+1 (555) 010-2000')).toBe('5550102000');
    expect(normalizePhone('555.010.2000')).toBe('5550102000');
    expect(normalizePhone('+84 90 123 4567')).toBe('84901234567');
  });
  it('builds wallet-agnostic destination keys', () => {
    expect(destinationKey(venmo('@Lan'))).toBe('USER_HANDLE:lan');
    expect(destinationKey(paypal(' Lan@Example.com '))).toBe('EMAIL:lan@example.com');
    expect(destinationKey({ type: 'PHONE', value: '+1 555 010 2000' })).toBe('PHONE:5550102000');
  });
  it('requires ≥7 phone digits to match households by phone', () => {
    expect(sameHousehold({ destination: null, phone: '123' }, { destination: lan, phone: '123' })).toBe(false);
    expect(sameHousehold({ destination: null }, { destination: lan })).toBe(false);
  });
  it('householdWindow honours custom day windows', () => {
    const h = [hist({ destination: lan, createdAt: daysAgo(10) })];
    expect(householdWindow(h, { destination: lan }, new Date(NOW), { days: 7 })).toHaveLength(0);
    expect(householdWindow(h, { destination: lan }, new Date(NOW), { days: 14 })).toHaveLength(1);
  });
  it('toDate rejects invalid dates', () => {
    expect(() => toDate('nope')).toThrow(RangeError);
    expect(toDate(new Date(0)).getTime()).toBe(0);
  });
});
