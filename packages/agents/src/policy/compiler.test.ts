import { describe, expect, it } from 'vitest';
import { DEMO_POLICY_SOURCE_TEXT, demoPolicy, type Policy } from '@neighborline/core';
import { createFixtureLLM } from '../fixtures/responders.js';
import { ScriptedLLM } from '../providers/fixture-llm.js';
import { parsePolicyOffline } from './offline-parser.js';
import { PolicyCompiler } from './compiler.js';
import { diffPolicies } from './diff.js';

const demo = demoPolicy();
const { id: _i, groupId: _g, createdAt: _c, approvedBy: _a, version: _v, ...demoDraft } = demo;

describe('PolicyCompiler', () => {
  it('compiles the demo rules into the demo policy draft (fixture mode)', async () => {
    const r = await new PolicyCompiler({ llm: createFixtureLLM() }).compile({ sourceText: DEMO_POLICY_SOURCE_TEXT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft).toEqual(demoDraft);
    expect(r.status).toBe('draft');
    expect(r.requiredApprovals).toBe(2);
    expect(r.proposedVersion).toBe(1);
    expect(r.diffText[0]).toBe('New rule — Utility outage: up to $150 per request, $300 per household in 30 days');
    expect(r.warnings).toEqual([]);
    expect(r.trace.status).toBe('valid');
  });

  it('never activates: the result has no id, no approvals, no version on the draft', async () => {
    const r = await new PolicyCompiler({ llm: createFixtureLLM() }).compile({ sourceText: DEMO_POLICY_SOURCE_TEXT, previous: demo });
    expect(r.ok && Object.keys(r.draft)).not.toContain('approvedBy');
    expect(r.ok && Object.keys(r.draft)).not.toContain('id');
    expect(r.ok && r.proposedVersion).toBe(2);
    expect(r.ok && r.diffText).toEqual(['No changes from the current policy.']);
  });

  it('shows a human-readable diff against the previous version', async () => {
    const text = DEMO_POLICY_SOURCE_TEXT.replace('up to $150 per request, at most $300', 'up to $200 per request, at most $300')
      .replace('- Rent gap: up to $250, once per household in 30 days. No photo needed.\n', '')
      .replace('at most twice in 30 days', 'at most 3 times in 30 days');
    const r = await new PolicyCompiler({ llm: createFixtureLLM() }).compile({ sourceText: text, previous: demo });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diffText).toEqual([
      'Utility outage: per-request max $150 → $200',
      'Removed Rent gap (was up to $250 per request, $250 per household in 30 days)',
      'Same payout account, max uses per 30 days: 2 → 3',
    ]);
  });

  it('an invented cap is sent back for repair; the fixed draft is accepted', async () => {
    const good = parsePolicyOffline(DEMO_POLICY_SOURCE_TEXT);
    const invented = { ...good, dailyBudgetCents: 300000 };
    const llm = new ScriptedLLM([JSON.stringify(invented), JSON.stringify(good)]);
    const r = await new PolicyCompiler({ llm }).compile({ sourceText: DEMO_POLICY_SOURCE_TEXT });
    expect(r.ok).toBe(true);
    expect(llm.calls[1]?.messages[2]?.content).toContain('- dailyBudgetCents: 3000 dollars does not appear in the rules text');
    expect(r.trace.repairedFields).toEqual(['dailyBudgetCents']);
  });

  it('core invariants (per-request max above household cap) are enforced and a misquote is caught', async () => {
    const good = parsePolicyOffline(DEMO_POLICY_SOURCE_TEXT);
    const bad = { ...good, categories: good.categories.map((c, i) => (i === 0 ? { ...c, perHouseholdPer30dCents: 10000, sourceQuote: 'Heat: $1 million' } : c)) };
    const llm = new ScriptedLLM([JSON.stringify(bad), JSON.stringify(bad)]);
    const r = await new PolicyCompiler({ llm }).compile({ sourceText: DEMO_POLICY_SOURCE_TEXT });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain('categories[0].sourceQuote');
    expect(paths).toContain('categories.0.maxCents');
  });

  it('parses other rule texts in the house style offline', () => {
    const m = parsePolicyOffline(`- Diapers and formula: up to $80 per request, $160 per household in 30 days.
- Anything else: up to $50, once per household in 30 days.
- No household gets more than $300 in any 30 days. We spend at most $1,000 per day.
- The same payout account can be used at most twice in 30 days.`);
    expect(m.categories.map((c) => [c.key, c.maxCents, c.perHouseholdPer30dCents])).toEqual([['diapers_and_formula', 8000, 16000], ['other', 5000, 5000]]);
    expect([m.householdCapPer30dCents, m.dailyBudgetCents, m.maxRequestsPerDestinationPer30d]).toEqual([30000, 100000, 2]);
  });
});

describe('diffPolicies', () => {
  it('reports photo, label and household cap changes', () => {
    const next: Policy = {
      ...demo,
      householdCapPer30dCents: 50000,
      categories: demo.categories.map((c) => (c.key === 'rent_gap' ? { ...c, requiresPhoto: true, label: { ...c.label, en: 'Rent help' } } : c)),
    };
    expect(diffPolicies(demo, next).map((c) => c.text)).toEqual([
      'Rent help: photo now required',
      'Renamed "Rent gap" → "Rent help"',
      'Household cap per 30 days: $400 → $500',
    ]);
  });
});
