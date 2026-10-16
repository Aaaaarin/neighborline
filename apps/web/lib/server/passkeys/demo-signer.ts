/**
 * DEMO_MODE only: one server-held software key per organizer (packages/passkeys), registered as a
 * `demo_key` credential and labelled "(demo key)" everywhere it appears — the approval card, the
 * audit log, the approval record the approval service re-verifies. It lets /demo play without a
 * phone in the room; it is never presented as a passkey.
 */
import { challengeForApprovalHash, createSoftwareAuthenticator, expectedFor, relyingParty, verifyApprovalAssertion, type SoftwareAuthenticator } from '@neighborline/passkeys';
import type { ApproverAssertion } from '@neighborline/core';
import { addOrganizerCredential, listOrganizers, recordApprovalAssertion, type Db } from '@neighborline/db';
import { HttpError } from '../errors';

type Env = Record<string, string | undefined>;

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineDemoSigners: Map<string, SoftwareAuthenticator> | undefined;
}

export const demoModeOn = (env: Env): boolean => env.DEMO_MODE !== 'false';

function signerFor(organizerId: string): SoftwareAuthenticator {
  const m = (globalThis.__neighborlineDemoSigners ??= new Map());
  let s = m.get(organizerId);
  if (!s) {
    s = createSoftwareAuthenticator();
    m.set(organizerId, s);
  }
  return s;
}

export const demoKeyLabel = (name: string): string => `${name}’s phone (demo key)`;

/** Sign `approvalHash` as `organizerId` with the demo key and store the assertion. */
export async function demoSign(db: Db, env: Env, input: { groupId: string; organizerId: string; approvalHash: string; at?: Date }): Promise<ApproverAssertion> {
  if (!demoModeOn(env)) throw new HttpError(403, 'Demo keys are off (DEMO_MODE=false). Sign with your passkey.');
  const org = (await listOrganizers(db, input.groupId)).find((o) => o.id === input.organizerId);
  if (!org) throw new HttpError(403, 'Unknown organizer');
  const signer = signerFor(org.id);
  const deviceLabel = demoKeyLabel(org.name);
  await addOrganizerCredential(db, { id: signer.credentialId, organizerId: org.id, publicKey: signer.publicKey, deviceLabel, kind: 'demo_key', actor: 'demo-signer' });
  const rp = relyingParty(env);
  const parts = signer.sign({ challenge: challengeForApprovalHash(input.approvalHash), origin: rp.origin, rpId: rp.rpId });
  // Same verifier the approval service runs: the demo key goes through the real check, not around it.
  const exp = expectedFor(rp, env)!;
  const ok = await verifyApprovalAssertion({ assertion: parts, approvalHash: input.approvalHash, credential: { id: signer.credentialId, publicKey: signer.publicKey, kind: 'demo_key' }, expectedOrigin: exp.expectedOrigin, expectedRpId: exp.expectedRpId });
  if (!ok.ok) throw new Error(`demo key signature did not verify: ${ok.reason}`);
  const assertion: ApproverAssertion = {
    v: 1,
    kind: 'demo_key',
    ...parts,
    rpId: rp.rpId,
    origin: rp.origin,
    approvalHash: input.approvalHash,
    deviceLabel,
    verifiedAt: (input.at ?? new Date()).toISOString(),
  };
  return (await recordApprovalAssertion(db, { organizerId: org.id, assertion })).assertion;
}
