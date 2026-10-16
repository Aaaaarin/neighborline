/**
 * DEMO_MODE only: one server-held software key per organizer (packages/passkeys), registered as a
 * `demo_key` credential and labelled "(demo key)" everywhere it appears — the approval card, the
 * audit log, the approval record the approval service re-verifies. It lets /demo play without a
 * phone in the room; it is never presented as a passkey.
 */
import { challengeFor, createSoftwareAuthenticator, demoModeOn as sharedDemoModeOn, expectedFor, newServerNonce, relyingParty, verifyApprovalAssertion, type SoftwareAuthenticator } from '@neighborline/passkeys';
import type { ApproverAssertion } from '@neighborline/core';
import { addOrganizerCredential, listOrganizers, recordApprovalAssertion, type Executor } from '@neighborline/db';
import { HttpError } from '../errors';

type Env = Record<string, string | undefined>;

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineDemoSigners: Map<string, SoftwareAuthenticator> | undefined;
}

/**
 * DEMO_MODE fails closed (QA P1-6): explicit DEMO_MODE=true|false wins; unset means on only with
 * PAYPAL_MODE=fake; never with live. Same reading as the approver.
 */
export const demoModeOn = (env: Env): boolean => sharedDemoModeOn(env);

/** The one organizer seat a /demo visitor may play (demo key or their own demo-visitor passkey). */
export const DEMO_SEAT = 'org_marcus';

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

/** Sign `approvalHash` as `organizerId` with the demo key (nonce-bound challenge) and store the assertion. */
export async function demoSign(db: Executor, env: Env, input: { groupId: string; organizerId: string; approvalHash: string; at?: Date }): Promise<ApproverAssertion> {
  const assertion = await demoAssert(db, env, { ...input, serverNonce: newServerNonce() });
  return (await recordApprovalAssertion(db, { organizerId: input.organizerId, assertion })).assertion;
}

/**
 * Sign any 32-byte hash (a payout approval hash or a policy draft hash) with the organizer's demo
 * key and verify it with the real verifier. Does not store it: the caller decides where it goes.
 */
export async function demoAssert(db: Executor, env: Env, input: { groupId: string; organizerId: string; approvalHash: string; at?: Date; serverNonce?: string }): Promise<ApproverAssertion> {
  if (!demoModeOn(env)) throw new HttpError(403, 'Demo keys are off (DEMO_MODE=false). Sign with your passkey.');
  const org = (await listOrganizers(db, input.groupId)).find((o) => o.id === input.organizerId);
  if (!org) throw new HttpError(403, 'Unknown organizer');
  const signer = signerFor(org.id);
  const deviceLabel = demoKeyLabel(org.name);
  await addOrganizerCredential(db, { id: signer.credentialId, organizerId: org.id, publicKey: signer.publicKey, deviceLabel, kind: 'demo_key', actor: 'demo-signer' });
  const rp = relyingParty(env);
  const parts = signer.sign({ challenge: challengeFor(input.approvalHash, input.serverNonce), origin: rp.origin, rpId: rp.rpId });
  // Same verifier the approval service runs: the demo key goes through the real check, not around it.
  const exp = expectedFor(rp, env)!;
  const ok = await verifyApprovalAssertion({ assertion: parts, approvalHash: input.approvalHash, credential: { id: signer.credentialId, publicKey: signer.publicKey, kind: 'demo_key' }, expectedOrigin: exp.expectedOrigin, expectedRpId: exp.expectedRpId, serverNonce: input.serverNonce });
  if (!ok.ok) throw new Error(`demo key signature did not verify: ${ok.reason}`);
  return {
    v: 1,
    kind: 'demo_key',
    ...parts,
    rpId: rp.rpId,
    origin: rp.origin,
    approvalHash: input.approvalHash,
    deviceLabel,
    verifiedAt: (input.at ?? new Date()).toISOString(),
    ...(input.serverNonce ? { serverNonce: input.serverNonce } : {}),
  };
}
