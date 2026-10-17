import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_POLICY_SOURCE_TEXT, policyDraftHash } from '@neighborline/core';
import { addOrganizerCredential, getActivePolicy, listAudit } from '@neighborline/db';
import { approvalHashFromChallenge, challengeForApprovalHash, createSoftwareAuthenticator } from '@neighborline/passkeys';
import { startHarness, type Harness } from './harness';
import type { PasskeyAssertionJSON, PolicyDraftView } from '../lib/types';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;
const ORIGIN = 'http://localhost:3000';

async function phone(organizerId: string, label: string) {
  const a = createSoftwareAuthenticator({ userVerified: true });
  await addOrganizerCredential(await db(), { id: a.credentialId, organizerId, publicKey: a.publicKey, deviceLabel: label, kind: 'passkey' });
  return a;
}

async function sign(a: ReturnType<typeof createSoftwareAuthenticator>, draftHash: string, challengeOverride?: string): Promise<PasskeyAssertionJSON> {
  const ch = await h.engine.policyChallenge({ draftHash, origin: ORIGIN });
  const p = a.sign({ challenge: challengeOverride ?? ch.optionsJSON.challenge, origin: ORIGIN, rpId: 'localhost' });
  return { id: p.credentialId, rawId: p.credentialId, type: 'public-key', response: { authenticatorData: p.authenticatorData, clientDataJSON: p.clientDataJSON, signature: p.signature } };
}

const V2_TEXT = DEMO_POLICY_SOURCE_TEXT.replace('up to $150 per request, at most $300', 'up to $120 per request, at most $300').replace(
  '- Anything else:',
  '- Baby supplies (diapers, formula, wipes): up to $80 per request, $160 per household in 30 days.\n- Anything else:',
);

describe('rules editor: AI drafts, two organizers sign, code activates', () => {
  let draft: PolicyDraftView;
  let dana: ReturnType<typeof createSoftwareAuthenticator>;
  let marcus: ReturnType<typeof createSoftwareAuthenticator>;

  it('drafts a reviewable policy: quotes per cap, code diff, queue preview; nothing changes yet', async () => {
    const r = await h.engine.compilePolicy({ sourceText: V2_TEXT, session: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    draft = r.draft;
    expect(draft).toMatchObject({ version: 2, baseVersion: 1, status: 'open', required: 2, signatures: [] });
    expect(draft.draftHash).toMatch(/^[0-9a-f]{64}$/);
    expect(draft.changes.map((c) => c.text)).toEqual([
      'Utility outage: per-request max $150 → $120',
      'Added Baby supplies: up to $80 per request, $160 per household in 30 days',
    ]);
    const baby = draft.categories.find((c) => c.key === 'baby_supplies')!;
    expect(baby).toMatchObject({ change: 'added', maxCents: 8000, quote: 'Baby supplies (diapers, formula, wipes): up to $80 per request, $160 per household in 30 days.' });
    expect(draft.categories.find((c) => c.key === 'utility_outage')).toMatchObject({ change: 'changed', before: { maxCents: 15000 } });
    expect(draft.limits.every((l) => l.quote)).toBe(true);
    expect(draft.trace.status).toBe('valid');
    const ana = draft.queue.find((q) => q.requestId === 'req_seed_q_ana')!;
    expect(ana).toMatchObject({ currentCents: 15000, draftCents: 12000, outcome: 'less' });
    const minh = draft.queue.find((q) => q.requestId === 'req_seed_q_minh')!;
    expect(minh).toMatchObject({ currentCents: 8000, draftCents: 8000, outcome: 'same', approvalsToRedo: ['Priya'] });
    expect((await getActivePolicy(await db(), 'grp_eastside'))?.version).toBe(1);
    // Drafting the same text again returns the same open draft.
    const again = await h.engine.compilePolicy({ sourceText: V2_TEXT, session: null });
    expect(again.ok && again.draft.draftHash).toBe(draft.draftHash);
  });

  it('one signature is not enough, and the same organizer twice counts once', async () => {
    dana = await phone('org_dana', 'Dana’s iPhone');
    const r1 = await h.engine.signPolicy({ draftHash: draft.draftHash, signer: { kind: 'passkey', assertion: await sign(dana, draft.draftHash) }, origin: ORIGIN });
    expect(r1.activated).toBeNull();
    expect(r1.draft.signatures.map((s) => [s.name, s.kind, s.counts])).toEqual([['Dana', 'passkey', true]]);
    const r2 = await h.engine.signPolicy({ draftHash: draft.draftHash, signer: { kind: 'passkey', assertion: await sign(dana, draft.draftHash) }, origin: ORIGIN });
    expect(r2.activated).toBeNull();
    expect(r2.draft.signatures).toHaveLength(1);
    expect((await h.engine.getGroup()).policy.version).toBe(1);
  });

  it('a signature over a tampered draft is rejected, and an unknown draft cannot be signed', async () => {
    marcus = await phone('org_marcus', 'Marcus’s Pixel');
    const ch = await h.engine.policyChallenge({ draftHash: draft.draftHash, origin: ORIGIN });
    expect(approvalHashFromChallenge(ch.optionsJSON.challenge)).toBe(draft.draftHash);
    // Same draft with a quietly raised cap: a different hash, so a signature over it does not cover this draft.
    const editor = await h.engine.policyEditor();
    const tampered = policyDraftHash({
      groupId: draft.groupId,
      basePolicyId: draft.basePolicyId,
      version: 2,
      body: { sourceText: V2_TEXT, currency: 'USD', categories: [], householdCapPer30dCents: 99_900, dailyBudgetCents: 999_900, maxRequestsPerDestinationPer30d: 9 },
    });
    expect(editor.draft?.draftHash).toBe(draft.draftHash);
    await expect(
      h.engine.signPolicy({ draftHash: draft.draftHash, signer: { kind: 'passkey', assertion: await sign(marcus, draft.draftHash, challengeForApprovalHash(tampered)) }, origin: ORIGIN }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(h.engine.signPolicy({ draftHash: tampered, signer: { kind: 'passkey', assertion: await sign(marcus, draft.draftHash) }, origin: ORIGIN })).rejects.toMatchObject({ status: 404 });
    expect((await h.engine.policyEditor()).draft?.signatures).toHaveLength(1);
    expect((await h.engine.getGroup()).policy.version).toBe(1);
  });

  it('the second organizer’s signature activates v2 and re-prices the queue under it', async () => {
    const r = await h.engine.signPolicy({ draftHash: draft.draftHash, signer: { kind: 'passkey', assertion: await sign(marcus, draft.draftHash) }, origin: ORIGIN });
    expect(r.activated).toMatchObject({ version: 2, repriced: 2 });
    expect(r.draft.status).toBe('activated');
    const active = (await getActivePolicy(await db(), 'grp_eastside'))!;
    expect(active).toMatchObject({ version: 2, approvedBy: ['org_dana', 'org_marcus'] });
    expect(active.categories.map((c) => c.key)).toContain('baby_supplies');
    expect((await h.engine.getGroup()).policy.version).toBe(2);
    // The title follows the version (QA-2 P3): the organizers wrote "(v1)", the active rules say "(v2)".
    expect(V2_TEXT.split('\n')[0]).toMatch(/\(v1\)$/);
    expect(active.sourceText.split('\n')[0]).toBe('Eastside Mutual Aid — rules for quick cash help (v2)');
    expect(active.sourceText.split('\n').slice(1)).toEqual(V2_TEXT.split('\n').slice(1));
    expect((await h.engine.policyEditor()).active.sourceText.split('\n')[0]).toMatch(/\(v2\)$/);
    const ana = (await h.engine.getRequest('req_seed_q_ana'))!;
    expect(ana.request.computed).toMatchObject({ amountCents: 12000 });
    expect(ana.request.computed?.ruleCitation).toContain('Policy v2');
    const minh = (await h.engine.getRequest('req_seed_q_minh'))!;
    expect(minh.approvals).toEqual([]); // Priya signed the v1 amounts; she signs again
    const actions = (await listAudit(await db())).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['policy.drafted', 'policy.signed_with_passkey', 'policy.activated', 'policy.draft_activated', 'request.repriced', 'approval.voided']));
    await expect(h.engine.signPolicy({ draftHash: draft.draftHash, signer: { kind: 'demo_key' }, organizerId: 'org_priya' })).rejects.toMatchObject({ status: 409 });
  });

  it('a revoked device’s signature stops counting; the demo key (DEMO_MODE) can complete instead', async () => {
    const r = await h.engine.compilePolicy({ sourceText: V2_TEXT.replace('Groceries: up to $100', 'Groceries: up to $110'), session: null });
    if (!r.ok) throw new Error('draft failed');
    const hash = r.draft.draftHash;
    expect(r.draft).toMatchObject({ version: 3, baseVersion: 2 });
    const s1 = await h.engine.signPolicy({ draftHash: hash, signer: { kind: 'passkey', assertion: await sign(dana, hash) }, origin: ORIGIN });
    expect(s1.activated).toBeNull();
    const session = { organizerId: 'org_marcus', name: 'Marcus', credentialId: marcus.credentialId, deviceLabel: 'Marcus’s Pixel', kind: 'passkey' as const };
    await h.engine.revokePasskey({ credentialId: dana.credentialId, session });
    expect(await h.engine.liveSession({ ...session, organizerId: 'org_dana', credentialId: dana.credentialId })).toBeNull();
    const s2 = await h.engine.signPolicy({ draftHash: hash, signer: { kind: 'passkey', assertion: await sign(marcus, hash) }, origin: ORIGIN });
    expect(s2.activated).toBeNull(); // Dana's signature no longer counts
    expect(s2.draft.signatures.map((s) => [s.name, s.counts])).toEqual([['Dana', false], ['Marcus', true]]);
    const s3 = await h.engine.signPolicy({ draftHash: hash, signer: { kind: 'demo_key' }, organizerId: 'org_priya' });
    expect(s3.activated).toMatchObject({ version: 3 });
    expect((await getActivePolicy(await db(), 'grp_eastside'))?.approvedBy).toEqual(['org_marcus', 'org_priya']);
  });

  it('refuses a draft that changes nothing', async () => {
    const editor = await h.engine.policyEditor();
    const r = await h.engine.compilePolicy({ sourceText: editor.active.sourceText, session: null });
    expect(r.ok).toBe(false);
    // Only the title's version marker differs (an old copy of the text): still nothing to sign.
    expect(editor.active.sourceText.split('\n')[0]).toMatch(/\(v3\)$/);
    const old = await h.engine.compilePolicy({ sourceText: editor.active.sourceText.replace('(v3)', '(v1)'), session: null });
    expect(old.ok).toBe(false);
  });
});
