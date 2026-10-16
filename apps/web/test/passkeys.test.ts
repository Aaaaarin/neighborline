import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOrganizerCredential, getApproval, listApprovalsForRequest, listAudit } from '@neighborline/db';
import { approvalHashFromChallenge, challengeFor, createSoftwareAuthenticator, verifyApprovalAssertion } from '@neighborline/passkeys';
import { startHarness, waitFor, type Harness } from './harness';
import type { PasskeyAssertionJSON } from '../lib/types';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;
const ORIGIN = 'http://localhost:3000';

/** A "phone": a software authenticator that reports user verification, enrolled as a passkey. */
async function phone(organizerId: string, label: string) {
  const a = createSoftwareAuthenticator({ userVerified: true });
  await addOrganizerCredential(await db(), { id: a.credentialId, organizerId, publicKey: a.publicKey, deviceLabel: label, kind: 'passkey' });
  return a;
}

const SAMPLES = ['jean', 'walter', 'lan', 'jean', 'walter'] as const;
let n = 0;
async function readyRequest() {
  const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_voice' });
  await h.engine.submitAudio(requestId, { sampleId: SAMPLES[n++ % SAMPLES.length]! });
  await h.engine.confirmIntake(requestId, { confirmed: true });
  return requestId;
}

async function tap(a: ReturnType<typeof createSoftwareAuthenticator>, requestId: string, challengeOverride?: string): Promise<PasskeyAssertionJSON> {
  const ch = await h.engine.approvalChallenge({ requestIds: [requestId], origin: ORIGIN });
  const p = a.sign({ challenge: challengeOverride ?? ch.optionsJSON.challenge, origin: ORIGIN, rpId: 'localhost' });
  return { id: p.credentialId, rawId: p.credentialId, type: 'public-key', response: { authenticatorData: p.authenticatorData, clientDataJSON: p.clientDataJSON, signature: p.signature } };
}

describe('organizer passkeys', () => {
  it('the approval challenge binds the approval hash to a fresh server nonce', async () => {
    const id = await readyRequest();
    const ch = await h.engine.approvalChallenge({ requestIds: [id], origin: ORIGIN });
    const again = await h.engine.approvalChallenge({ requestIds: [id], origin: ORIGIN });
    expect(ch.approvalHash).toBe(again.approvalHash);
    expect(ch.optionsJSON.challenge).not.toBe(again.optionsJSON.challenge);
    // not the bare hash any more (a captured signature would otherwise be valid for identical content forever)
    expect(approvalHashFromChallenge(ch.optionsJSON.challenge)).not.toBe(ch.approvalHash);
    expect(ch.optionsJSON).toMatchObject({ rpId: 'localhost', userVerification: 'required' });
  });

  it('a captured assertion cannot be replayed (single-use nonce), and a bare-hash signature is refused', async () => {
    const id = await readyRequest();
    const dana = await phone('org_dana', 'Dana’s old phone');
    const signed = await tap(dana, id);
    await h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: signed }, origin: ORIGIN });
    await expect(h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: signed }, origin: ORIGIN })).rejects.toMatchObject({ status: 409 });
    const marcus = await phone('org_marcus', 'Marcus’s old phone');
    const ch = await h.engine.approvalChallenge({ requestIds: [id], origin: ORIGIN });
    const bare = await tap(marcus, id, challengeFor(ch.approvalHash));
    await expect(h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: bare }, origin: ORIGIN })).rejects.toMatchObject({ status: 409 });
  });

  it('two passkeys on two phones → paid; approvers[].assertion re-verifies offline', async () => {
    const id = await readyRequest();
    const dana = await phone('org_dana', 'Dana’s iPhone');
    const marcus = await phone('org_marcus', 'Marcus’s Pixel');
    const r1 = await h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: await tap(dana, id) }, origin: ORIGIN });
    expect(r1).toMatchObject({ count: 1, executed: false, signer: { organizerId: 'org_dana', kind: 'passkey', deviceLabel: 'Dana’s iPhone' } });
    const r2 = await h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: await tap(marcus, id) }, origin: ORIGIN });
    expect(r2).toMatchObject({ count: 2, executed: true });

    const approval = (await getApproval(await db(), r2.approvalId))!;
    expect(approval.approvers.map((a) => [a.organizerId, a.assertion?.kind, a.assertion?.deviceLabel])).toEqual([
      ['org_dana', 'passkey', 'Dana’s iPhone'],
      ['org_marcus', 'passkey', 'Marcus’s Pixel'],
    ]);
    for (const [ap, key] of [[approval.approvers[0]!, dana], [approval.approvers[1]!, marcus]] as const) {
      expect(ap.assertion!.serverNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const v = await verifyApprovalAssertion({ assertion: ap.assertion!, approvalHash: approval.hash, credential: { id: key.credentialId, publicKey: key.publicKey, kind: 'passkey' }, expectedOrigin: ORIGIN, expectedRpId: 'localhost', serverNonce: ap.assertion!.serverNonce });
      expect(v.ok).toBe(true);
    }
    const view = (await h.engine.getRequest(id))!;
    expect(view.approvals.map((a) => a.signer)).toEqual([
      { kind: 'passkey', deviceLabel: 'Dana’s iPhone' },
      { kind: 'passkey', deviceLabel: 'Marcus’s Pixel' },
    ]);
    await waitFor(async () => (await h.engine.getRequest(id))?.request.status === 'paid', 15_000, 'paid');
    const audit = await listAudit(await db());
    expect(audit.filter((e) => e.action === 'approval.signed_with_passkey' && e.entityId === approval.hash)).toHaveLength(2);
  });

  it('the approver is whoever owns the credential, not whoever the body claims', async () => {
    const id = await readyRequest();
    const dana = await phone('org_dana', 'Dana’s laptop');
    await expect(h.engine.approve({ requestIds: [id], organizerId: 'org_marcus', signer: { kind: 'passkey', assertion: await tap(dana, id) }, origin: ORIGIN })).rejects.toMatchObject({ status: 403 });
    const ok = await h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: await tap(dana, id) }, origin: ORIGIN });
    expect(ok.signer?.organizerId).toBe('org_dana');
  });

  it('refuses a signature over different content, an unknown key, or a key without user verification', async () => {
    const id = await readyRequest();
    const dana = await phone('org_dana', 'Dana’s tablet');
    const other = 'A'.repeat(43);
    await expect(h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: await tap(dana, id, other) }, origin: ORIGIN })).rejects.toMatchObject({ status: 409 });
    const stranger = createSoftwareAuthenticator({ userVerified: true });
    await expect(h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: await tap(stranger, id) }, origin: ORIGIN })).rejects.toMatchObject({ status: 401 });
    const noUv = createSoftwareAuthenticator();
    await addOrganizerCredential(await db(), { id: noUv.credentialId, organizerId: 'org_dana', publicKey: noUv.publicKey, deviceLabel: 'no UV', kind: 'passkey' });
    await expect(h.engine.approve({ requestIds: [id], signer: { kind: 'passkey', assertion: await tap(noUv, id) }, origin: ORIGIN })).rejects.toMatchObject({ status: 409 });
    expect((await listApprovalsForRequest(await db(), id)).flatMap((a) => a.approvers)).toEqual([]);
  });

  it('demo keys are labelled, verify like passkeys, and are refused when DEMO_MODE=false', async () => {
    const id = await readyRequest();
    const r = await h.engine.approve({ requestIds: [id], organizerId: 'org_dana', signer: { kind: 'demo_key' } });
    expect(r.signer).toEqual({ organizerId: 'org_dana', kind: 'demo_key', deviceLabel: 'Dana’s phone (demo key)' });
    const audit = await listAudit(await db());
    expect(audit.some((e) => e.action === 'approval.signed_with_demo_key')).toBe(true);
    const env = (h.engine as unknown as { env: Record<string, string | undefined> }).env;
    env.DEMO_MODE = 'false';
    try {
      await expect(h.engine.approve({ requestIds: [id], organizerId: 'org_marcus', signer: { kind: 'demo_key' } })).rejects.toMatchObject({ status: 403 });
    } finally {
      delete env.DEMO_MODE;
    }
  });
});

describe('demo-visitor passkeys and invite codes (QA P1-6)', () => {
  it('a real organizer seat needs an invite code even in DEMO_MODE', async () => {
    await expect(h.engine.passkeyRegistrationOptions({ organizerId: 'org_priya', origin: ORIGIN, session: null })).rejects.toMatchObject({ status: 403 });
    await expect(h.engine.passkeyRegistrationOptions({ organizerId: 'org_marcus', origin: ORIGIN, session: null })).rejects.toMatchObject({ status: 403 });
    const roster = await h.engine.passkeyRoster();
    expect(roster.inviteRequired).toBe(true);
  });

  it('the demo-visitor path enrolls only Marcus, and only in DEMO_MODE', async () => {
    await expect(h.engine.passkeyRegistrationOptions({ organizerId: 'org_dana', origin: ORIGIN, session: null, demoVisitorTag: 'abcdefabcdef' })).rejects.toMatchObject({ status: 403 });
    const ok = await h.engine.passkeyRegistrationOptions({ organizerId: 'org_marcus', origin: ORIGIN, session: null, demoVisitorTag: 'abcdefabcdef' });
    expect(ok.optionsJSON).toBeTruthy();
    const env = (h.engine as unknown as { env: Record<string, string | undefined> }).env;
    env.DEMO_MODE = 'false';
    try {
      await expect(h.engine.passkeyRegistrationOptions({ organizerId: 'org_marcus', origin: ORIGIN, session: null, demoVisitorTag: 'abcdefabcdef' })).rejects.toMatchObject({ status: 403 });
    } finally {
      env.DEMO_MODE = 'true';
    }
  });

  it('a visitor-bound passkey signs only that visitor’s demo runs and never signs in', async () => {
    const tag = '0123456789ab';
    const a = createSoftwareAuthenticator({ userVerified: true });
    await addOrganizerCredential(await db(), { id: a.credentialId, organizerId: 'org_marcus', publicKey: a.publicKey, deviceLabel: 'Visitor’s Mac (as Marcus)', kind: 'passkey', boundTo: `demo-visitor:${tag}` });
    // someone else's real request: refused
    const real = 'req_seed_q_ana';
    await expect(h.engine.approve({ requestIds: [real], signer: { kind: 'passkey', assertion: await tap(a, real) }, origin: ORIGIN })).rejects.toMatchObject({ status: 403 });
    // the visitor's own demo run: accepted
    const run = await h.engine.playScenario({ scenario: 'jean', mode: 'manual', speed: 20, visitorTag: tag });
    expect(run.requestId).toMatch(new RegExp(`^req_demo_${tag}_[0-9a-f]+$`));
    await waitFor(async () => (await h.engine.getRequest(run.requestId))?.request.status === 'awaiting_approval', 15_000, 'awaiting');
    const r = await h.engine.approve({ requestIds: [run.requestId], signer: { kind: 'passkey', assertion: await tap(a, run.requestId) }, origin: ORIGIN });
    expect(r.signer).toMatchObject({ organizerId: 'org_marcus', kind: 'passkey' });
    // another visitor's run: refused
    const other = await h.engine.playScenario({ scenario: 'rosa', mode: 'manual', speed: 20, visitorTag: 'ffffffffffff' });
    await waitFor(async () => (await h.engine.getRequest(other.requestId))?.request.status === 'awaiting_approval', 15_000, 'awaiting');
    await expect(h.engine.approve({ requestIds: [other.requestId], signer: { kind: 'passkey', assertion: await tap(a, other.requestId) }, origin: ORIGIN })).rejects.toMatchObject({ status: 403 });
    // it is not an organizer login
    const sess = { organizerId: 'org_marcus', name: 'Marcus', credentialId: a.credentialId, deviceLabel: 'x', kind: 'passkey' as const };
    expect(await h.engine.liveSession(sess)).toBeNull();
    expect((await h.engine.passkeyRoster()).organizers.find((o) => o.id === 'org_marcus')!.passkeys.some((p) => p.id === a.credentialId)).toBe(false);
  });
});
