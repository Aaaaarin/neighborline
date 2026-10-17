import { describe, expect, it } from 'vitest';
import { approvalPayload } from './approvals.js';
import { demoPolicy } from './policy.js';
import { policyDraftHash, policyDraftPayload, policyTextSansVersion, stampPolicyVersion, type PolicyDraftContent } from './policy-draft.js';

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

describe('stampPolicyVersion (QA-2 P3: the title kept "(v1)" after v2 activated)', () => {
  const v1 = 'Eastside Mutual Aid — rules for quick cash help (v1)\n- Groceries: up to $100 (v1 caps).';
  it('sets the title marker to the new version and leaves every rule line alone', () => {
    expect(stampPolicyVersion(v1, 2)).toBe('Eastside Mutual Aid — rules for quick cash help (v2)\n- Groceries: up to $100 (v1 caps).');
    expect(stampPolicyVersion(stampPolicyVersion(v1, 2), 13).split('\n')[0]).toMatch(/\(v13\)$/);
    expect(stampPolicyVersion('Rules (v1)  ', 3)).toBe('Rules (v3)  ');
  });
  it('adds nothing to a title without a marker; a one-line text is its own title', () => {
    expect(stampPolicyVersion('Our rules\n- Food: $50', 2)).toBe('Our rules\n- Food: $50');
    expect(stampPolicyVersion('- Food: $50 (v1)', 2)).toBe('- Food: $50 (v2)');
    expect(stampPolicyVersion('', 2)).toBe('');
  });
  it('compares wording without the marker', () => {
    expect(policyTextSansVersion(v1)).toBe(policyTextSansVersion(stampPolicyVersion(v1, 2)));
    expect(policyTextSansVersion(v1).split('\n')[0]).toBe('Eastside Mutual Aid — rules for quick cash help');
    expect(policyTextSansVersion('Our rules\n- Food')).toBe('Our rules\n- Food');
  });
});
