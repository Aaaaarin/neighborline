import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApproverAssertion } from '@neighborline/core';
import type { DbHandle } from './client.js';
import { listAudit, verifyAuditChain } from './repo/audit.js';
import { addApproverTx, createOrGetApproval, getApproval } from './repo/approvals.js';
import {
  addOrganizerCredential,
  getOrganizerCredential,
  listApprovalAssertions,
  listApprovalAssertionsFor,
  listOrganizerCredentials,
  recordApprovalAssertion,
  touchOrganizerCredential,
} from './repo/credentials.js';
import { freshDb, readyRequest, withGroup } from './test-db.js';

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
  await withGroup(h);
});
afterAll(async () => h.close());

const assertion = (hash: string, credentialId: string, kind: ApproverAssertion['kind'] = 'passkey'): ApproverAssertion => ({
  v: 1,
  kind,
  credentialId,
  authenticatorData: 'A'.repeat(50),
  clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
  signature: 'MEUCIQ',
  rpId: 'localhost',
  origin: 'http://localhost:3000',
  approvalHash: hash,
  deviceLabel: 'A’s iPhone',
  verifiedAt: '2026-10-16T18:00:00.000Z',
});

describe('organizer credentials', () => {
  it('stores a passkey per organizer and refuses to move it to another organizer', async () => {
    const c = await addOrganizerCredential(h.db, { id: 'cred_a1', organizerId: 'org_a', publicKey: 'pQECAyYgASFY', deviceLabel: 'A’s iPhone', kind: 'passkey', transports: ['internal'] });
    expect(c).toMatchObject({ id: 'cred_a1', organizerId: 'org_a', counter: 0, kind: 'passkey', transports: ['internal'] });
    await expect(addOrganizerCredential(h.db, { id: 'cred_a1', organizerId: 'org_a', publicKey: 'x', deviceLabel: 'again', kind: 'passkey' })).resolves.toMatchObject({ deviceLabel: 'A’s iPhone' });
    await expect(addOrganizerCredential(h.db, { id: 'cred_a1', organizerId: 'org_b', publicKey: 'x', deviceLabel: 'B', kind: 'passkey' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(addOrganizerCredential(h.db, { id: 'cred_z', organizerId: 'org_nobody', publicKey: 'x', deviceLabel: 'Z', kind: 'passkey' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await addOrganizerCredential(h.db, { id: 'cred_b_demo', organizerId: 'org_b', publicKey: 'pQECAyYgASFY', deviceLabel: 'B’s phone (demo key)', kind: 'demo_key' });
    expect((await listOrganizerCredentials(h.db, 'org_b', { kind: 'demo_key' })).map((x) => x.id)).toEqual(['cred_b_demo']);
    expect(await listOrganizerCredentials(h.db, 'org_b', { kind: 'passkey' })).toEqual([]);
    await touchOrganizerCredential(h.db, 'cred_a1', 7);
    expect(await getOrganizerCredential(h.db, 'cred_a1')).toMatchObject({ counter: 7 });
    const audit = await listAudit(h.db);
    expect(audit.map((e) => e.action)).toEqual(expect.arrayContaining(['organizer.passkey_added', 'organizer.demo_key_added']));
  });

  it('attaches each approver’s assertion to the approval record (approvers[].assertion)', async () => {
    const r = await readyRequest(h);
    const { approval } = await createOrGetApproval(h.db, { requestIds: [r.id] });
    const a1 = await recordApprovalAssertion(h.db, { organizerId: 'org_a', assertion: assertion(approval.hash, 'cred_a1') });
    expect(a1.created).toBe(true);
    const again = await recordApprovalAssertion(h.db, { organizerId: 'org_a', assertion: { ...assertion(approval.hash, 'cred_a1'), signature: 'ZZZZ' } });
    expect(again).toMatchObject({ created: false, assertion: { signature: 'MEUCIQ' } });
    await recordApprovalAssertion(h.db, { organizerId: 'org_b', assertion: assertion(approval.hash, 'cred_b_demo', 'demo_key') });
    await addApproverTx(h.db, { approvalId: approval.id, organizerId: 'org_a', deviceLabel: 'A’s iPhone' });
    await addApproverTx(h.db, { approvalId: approval.id, organizerId: 'org_b', deviceLabel: 'B’s phone (demo key)' });
    const full = await getApproval(h.db, approval.id);
    expect(full?.status).toBe('complete');
    expect(full?.approvers.map((a) => [a.organizerId, a.assertion?.kind, a.assertion?.credentialId])).toEqual([
      ['org_a', 'passkey', 'cred_a1'],
      ['org_b', 'demo_key', 'cred_b_demo'],
    ]);
    expect((await listApprovalAssertions(h.db, approval.hash)).size).toBe(2);
    expect((await listApprovalAssertionsFor(h.db, [approval.hash, 'f'.repeat(64)])).get(approval.hash)?.size).toBe(2);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });

  it('refuses an assertion from someone else’s credential or with the wrong kind', async () => {
    const hash = 'c'.repeat(64);
    await expect(recordApprovalAssertion(h.db, { organizerId: 'org_b', assertion: assertion(hash, 'cred_a1') })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(recordApprovalAssertion(h.db, { organizerId: 'org_a', assertion: assertion(hash, 'cred_a1', 'demo_key') })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(recordApprovalAssertion(h.db, { organizerId: 'org_a', assertion: assertion(hash, 'nope') })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
