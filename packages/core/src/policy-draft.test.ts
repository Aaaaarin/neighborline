import { describe, expect, it } from 'vitest';
import { approvalPayload } from './approvals.js';
import { demoPolicy } from './policy.js';
import { policyDraftHash, policyDraftPayload, type PolicyDraftContent } from './policy-draft.js';

const { id: _i, groupId, createdAt: _c, approvedBy: _a, version: _v, ...body } = demoPolicy();
const base: PolicyDraftContent = { groupId, basePolicyId: 'pol_eastside_v1', version: 2, body };

describe('policyDraftHash', () => {
  it('is deterministic and independent of key order', () => {
    const shuffled = JSON.parse(JSON.stringify({ version: 2, body: { ...body }, basePolicyId: 'pol_eastside_v1', groupId })) as PolicyDraftContent;
    expect(policyDraftHash(shuffled)).toBe(policyDraftHash(base));
    expect(policyDraftHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any cap, label, the source text, the version or the base changes', () => {
    const h = policyDraftHash(base);
    const cat0 = body.categories[0]!;
    const variants: PolicyDraftContent[] = [
      { ...base, body: { ...body, categories: [{ ...cat0, maxCents: cat0.maxCents + 1 }, ...body.categories.slice(1)] } },
      { ...base, body: { ...body, categories: [{ ...cat0, label: { ...cat0.label, es: 'x' } }, ...body.categories.slice(1)] } },
      { ...base, body: { ...body, sourceText: `${body.sourceText} ` } },
      { ...base, body: { ...body, dailyBudgetCents: body.dailyBudgetCents - 100 } },
      { ...base, version: 3 },
      { ...base, basePolicyId: 'pol_other' },
      { ...base, groupId: 'grp_other' },
    ];
    for (const v of variants) expect(policyDraftHash(v)).not.toBe(h);
  });

  it('is domain-separated from payout approval hashes', () => {
    const payout = approvalPayload({ policyVersionId: 'pol_eastside_v1', items: [{ requestId: 'req_1', amountCents: 100, destination: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@x' } }] });
    expect(policyDraftPayload(base).domain).toBe('neighborline/policy-draft/v1');
    expect(Object.keys(payout)).not.toContain('domain');
  });
});
