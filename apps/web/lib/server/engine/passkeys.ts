/**
 * Organizer passkeys (WebAuthn): enrollment, sign-in, and the per-tap approval signature whose
 * challenge is the approval hash (core approvalHash of the requests being approved). The verified
 * assertion is stored in approval_assertions BEFORE the approval service records the approver, so
 * the approval record it executes from carries approvers[].assertion for every approver.
 * See NOTES-passkeys.md.
 */
import { approvalHash, type ApproverAssertion, type HelpRequest } from '@neighborline/core';
import {
  addOrganizerCredential,
  contentFromRequests,
  findLiveOrganizerInvite,
  getOrganizerCredential,
  getRequest,
  listOrganizerCredentials,
  listOrganizers,
  recordApprovalAssertion,
  RepoError,
  revokeOrganizerCredential,
  touchOrganizerCredential,
} from '@neighborline/db';
import { challengeFor, expectedFor, fromB64url, hexToBytes, newServerNonce, relyingParty, toB64url, verifyApprovalAssertion } from '@neighborline/passkeys';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { decodeClientDataJSON, isoBase64URL } from '@simplewebauthn/server/helpers';
import type { ApprovalChallenge, ApproveInput, OrganizerSession, PasskeyAssertionJSON, PasskeyRoster } from '../../types';
import { HttpError } from '../errors';
import { newChallenge, takeChallenge } from '../passkeys/challenges';
import { DEMO_SEAT, demoModeOn, demoSign } from '../passkeys/demo-signer';
import { bindingTag, DEMO_VISITOR_BINDING, demoRunTagOf } from '../security/visitor';
import type { BaseCtx } from './context';

type Ctx = Pick<BaseCtx, 'db' | 'env' | 'gen'>;

async function organizer(ctx: Ctx, organizerId: string) {
  const org = (await listOrganizers(ctx.db, ctx.gen.group.id)).find((o) => o.id === organizerId);
  if (!org) throw new HttpError(403, 'Unknown organizer');
  return org;
}

const challengeOf = (clientDataJSON: string): string => {
  try {
    return decodeClientDataJSON(clientDataJSON).challenge;
  } catch {
    throw new HttpError(400, 'Malformed passkey response');
  }
};

/* ---------------- roster + enrollment ---------------- */

export async function roster(ctx: Ctx): Promise<PasskeyRoster> {
  const orgs = await listOrganizers(ctx.db, ctx.gen.group.id);
  return {
    demoMode: demoModeOn(ctx.env),
    // A real organizer always needs an invite code (or a session as themselves), demo or not (QA P1-6).
    inviteRequired: true,
    organizers: await Promise.all(
      orgs.map(async (o) => ({
        id: o.id,
        name: o.name,
        // Demo-visitor passkeys are not the organizer's devices: they never appear in the roster.
        passkeys: (await listOrganizerCredentials(ctx.db, o.id, { kind: 'passkey' })).filter((c) => !c.boundTo).map((c) => ({ id: c.id, deviceLabel: c.deviceLabel, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })),
      })),
    ),
  };
}

const INVITE_REFUSED = 'That invite code is wrong, expired or already used. Ask another organizer for a new one.';

/**
 * Who may enroll a passkey for an organizer: that organizer when already signed in (adding a
 * device), or anyone holding a live invite code for that organizer, in DEMO_MODE too. Invite codes
 * are single use and expire (THREAT_MODEL R13): this check only looks; `register` spends the code in
 * the same transaction that stores the passkey. The one exception is the demo-visitor path
 * (`demoVisitorTag`): in DEMO_MODE a /demo visitor may enroll their own device to play Marcus, and
 * that credential is bound to the visitor ('demo-visitor:<tag>'): it signs only that visitor's own
 * demo runs, never signs in, never signs a policy, and is not listed as Marcus's device.
 *
 * Returns the invite code to spend on enrollment, or null when none is needed.
 */
async function assertMayEnroll(ctx: Ctx, organizerId: string, inviteCode: string | undefined, session: OrganizerSession | null, demoVisitorTag?: string): Promise<string | null> {
  if (demoVisitorTag) {
    if (!demoModeOn(ctx.env)) throw new HttpError(403, 'Demo passkeys are off (DEMO_MODE is off). Ask another organizer for an invite code.');
    if (organizerId !== DEMO_SEAT) throw new HttpError(403, 'In this demo you can play Marcus only.');
    return null;
  }
  if (session?.organizerId === organizerId) return null;
  const code = inviteCode?.trim();
  if (!code) throw new HttpError(403, 'Ask another organizer for your invite code to set up a passkey.');
  if (!(await findLiveOrganizerInvite(ctx.db, { organizerId, code }))) throw new HttpError(403, INVITE_REFUSED);
  return code;
}

export async function registrationOptions(ctx: Ctx, input: { organizerId: string; origin: string | null; inviteCode?: string; session: OrganizerSession | null; demoVisitorTag?: string }) {
  const org = await organizer(ctx, input.organizerId);
  await assertMayEnroll(ctx, org.id, input.inviteCode, input.session, input.demoVisitorTag);
  const rp = relyingParty(ctx.env, input.origin);
  const existing = await listOrganizerCredentials(ctx.db, org.id, { kind: 'passkey' });
  const optionsJSON = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: org.handles.find((h) => h.includes('@') && !h.startsWith('@')) ?? org.name,
    userDisplayName: `${org.name} · ${ctx.gen.group.name}`,
    userID: new TextEncoder().encode(org.id),
    challenge: newChallenge({ purpose: 'register', organizerId: org.id, origin: rp.origin, rpId: rp.rpId, ...(input.demoVisitorTag ? { boundTo: DEMO_VISITOR_BINDING(input.demoVisitorTag) } : {}) }),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { optionsJSON };
}

export async function register(
  ctx: Ctx,
  input: { organizerId: string; origin: string | null; response: Parameters<typeof verifyRegistrationResponse>[0]['response']; deviceLabel: string; inviteCode?: string; session: OrganizerSession | null; demoVisitorTag?: string },
): Promise<OrganizerSession> {
  const org = await organizer(ctx, input.organizerId);
  const inviteCode = await assertMayEnroll(ctx, org.id, input.inviteCode, input.session, input.demoVisitorTag);
  const pending = takeChallenge(challengeOf(input.response.response.clientDataJSON), 'register');
  const boundTo = input.demoVisitorTag ? DEMO_VISITOR_BINDING(input.demoVisitorTag) : undefined;
  if (!pending || pending.organizerId !== org.id || pending.boundTo !== boundTo) throw new HttpError(400, 'That passkey prompt expired. Try again.');
  let info;
  try {
    const v = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: () => true, // one-time challenge already matched above
      expectedOrigin: pending.origin,
      expectedRPID: pending.rpId,
      requireUserVerification: true,
    });
    if (!v.verified) throw new Error('not verified');
    info = v.registrationInfo;
  } catch (err) {
    throw new HttpError(400, `Couldn’t verify that passkey: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
  let label = input.deviceLabel.trim().slice(0, 60) || `${org.name}’s passkey`;
  // A demo visitor's device is always labelled as such ("Visitor’s Mac (as Marcus)"), never as Marcus's own.
  if (boundTo && !label.startsWith('Visitor’s ')) label = `Visitor’s ${label}`.slice(0, 60);
  if (boundTo && !label.includes(`(as ${org.name})`)) label = `${label.slice(0, 50)} (as ${org.name})`;
  try {
    await addOrganizerCredential(ctx.db, {
      id: info.credential.id,
      organizerId: org.id,
      publicKey: toB64url(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      deviceLabel: label,
      kind: 'passkey',
      backedUp: info.credentialBackedUp,
      ...(boundTo ? { boundTo, actor: `demo visitor ${input.demoVisitorTag}` } : {}),
      // Spent in the same transaction: no passkey without a live code, and a code adds one passkey only.
      ...(inviteCode ? { inviteCode } : {}),
    });
  } catch (err) {
    if (err instanceof RepoError && err.code === 'INVALID') throw new HttpError(403, INVITE_REFUSED);
    if (err instanceof RepoError) throw new HttpError(409, err.message);
    throw err;
  }
  return { organizerId: org.id, name: org.name, credentialId: info.credential.id, deviceLabel: label, kind: 'passkey' };
}

/* ---------------- sign-in ---------------- */

export async function signInOptions(ctx: Ctx, input: { origin: string | null }) {
  const rp = relyingParty(ctx.env, input.origin);
  const optionsJSON = await generateAuthenticationOptions({ rpID: rp.rpId, userVerification: 'required', challenge: newChallenge({ purpose: 'signin', origin: rp.origin, rpId: rp.rpId }) });
  return { optionsJSON };
}

export async function signIn(ctx: Ctx, input: { response: PasskeyAssertionJSON }): Promise<OrganizerSession> {
  const pending = takeChallenge(challengeOf(input.response.response.clientDataJSON), 'signin');
  if (!pending) throw new HttpError(400, 'That passkey prompt expired. Try again.');
  const cred = await getOrganizerCredential(ctx.db, input.response.id);
  if (!cred || cred.kind !== 'passkey') throw new HttpError(401, 'This passkey isn’t registered here. Set one up first.');
  if (cred.boundTo) throw new HttpError(403, 'This is a demo passkey: it signs your own /demo runs as Marcus and can’t sign in as an organizer.');
  const org = await organizer(ctx, cred.organizerId);
  try {
    const v = await verifyAuthenticationResponse({
      response: { ...input.response, clientExtensionResults: input.response.clientExtensionResults ?? {} } as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: () => true,
      expectedOrigin: pending.origin,
      expectedRPID: pending.rpId,
      credential: { id: cred.id, publicKey: isoBase64URL.toBuffer(cred.publicKey), counter: cred.counter, transports: cred.transports },
      requireUserVerification: true,
    });
    if (!v.verified) throw new Error('not verified');
    await touchOrganizerCredential(ctx.db, cred.id, v.authenticationInfo.newCounter);
  } catch (err) {
    throw new HttpError(401, `Couldn’t verify that passkey: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
  return { organizerId: org.id, name: org.name, credentialId: cred.id, deviceLabel: cred.deviceLabel, kind: 'passkey' };
}

/* ---------------- approval taps ---------------- */

/** The approval hash of these requests as they are right now (what the approval service will recompute). */
export async function currentApprovalHash(ctx: Ctx, requestIds: string[]): Promise<string> {
  const ids = [...new Set(requestIds)];
  const reqs: HelpRequest[] = [];
  for (const id of ids) {
    const r = await getRequest(ctx.db, id);
    if (!r || r.groupId !== ctx.gen.group.id) throw new HttpError(404, `No request ${id}`);
    const block = r.railFlags.find((f) => f.severity === 'block');
    if (block) throw new HttpError(409, `Blocked by rail protection: ${block.detail}`);
    if (!r.computed || !r.payoutDestination || !r.policyVersionId) throw new HttpError(409, 'This request isn’t ready for approval.');
    reqs.push(r);
  }
  try {
    return approvalHash(contentFromRequests(reqs));
  } catch (err) {
    throw new HttpError(409, err instanceof Error ? err.message : 'Not approvable');
  }
}

/**
 * Approval tap challenge = challengeFor(approvalHash, serverNonce): the hash commits to exactly what
 * will be paid, the nonce (single use, 5 min, stored with the assertion) makes the signature
 * unusable for any later approval with identical content (QA P2-12).
 */
export async function approvalChallenge(ctx: Ctx, input: { requestIds: string[]; origin: string | null; organizerId?: string; credentialIds?: string[] }): Promise<ApprovalChallenge> {
  const hash = await currentApprovalHash(ctx, input.requestIds);
  const optionsJSON = await challengeOptionsFor(ctx, hash, { ...input, nonce: newServerNonce() });
  return { approvalHash: hash, optionsJSON: optionsJSON as unknown as ApprovalChallenge['optionsJSON'] };
}

/**
 * Verify one Approve tap and store its assertion. Returns who signed (from the credential, never
 * from the request body) and the label to show. Throws 401/409 if the signature doesn't cover
 * exactly the current approval content.
 */
export async function signTap(ctx: Ctx, input: ApproveInput & { origin: string | null }): Promise<{ organizerId: string; assertion: ApproverAssertion }> {
  const hash = await currentApprovalHash(ctx, input.requestIds);
  if (input.signer.kind === 'demo_key') {
    const organizerId = input.organizerId;
    if (!organizerId) throw new HttpError(400, 'Say which organizer the demo key signs for.');
    await organizer(ctx, organizerId);
    return { organizerId, assertion: await demoSign(ctx.db, ctx.env, { groupId: ctx.gen.group.id, organizerId, approvalHash: hash }) };
  }
  const pending = takeChallenge(challengeOf(input.signer.assertion.response.clientDataJSON), 'approve');
  if (!pending?.serverNonce || !pending.approvalHash) throw new HttpError(409, 'That approval prompt expired or was already used. Tap Approve again.');
  if (pending.approvalHash !== hash) throw new HttpError(409, 'The request changed after the prompt opened. Review it again.');
  const { organizerId, assertion } = await verifyPasskeyOver(ctx, input.signer.assertion, hash, input.organizerId, { serverNonce: pending.serverNonce, requestIds: input.requestIds });
  const stored = await recordApprovalAssertion(ctx.db, { organizerId, assertion });
  return { organizerId, assertion: stored.assertion };
}

/**
 * Verify a browser's WebAuthn assertion over `hash` (its challenge must be the hash's 32 bytes),
 * with user verification, from an allowed origin, by a registered, unrevoked passkey. Returns the
 * organizer who owns the credential (never the one the body claims) and the assertion to store.
 * Used for Approve taps (payout approval hash) and policy activation (policy draft hash).
 */
export async function verifyPasskeyOver(
  ctx: Ctx,
  a: PasskeyAssertionJSON,
  hash: string,
  claimedOrganizerId?: string,
  opts: { serverNonce?: string; requestIds?: readonly string[] } = {},
): Promise<{ organizerId: string; assertion: ApproverAssertion }> {
  const cred = await getOrganizerCredential(ctx.db, a.id);
  if (!cred || cred.kind !== 'passkey') throw new HttpError(401, 'This passkey isn’t registered here.');
  if (cred.boundTo) {
    // A /demo visitor's own device playing Marcus: only that visitor's own demo runs, only in DEMO_MODE.
    const tag = bindingTag(cred.boundTo);
    const ids = opts.requestIds ?? [];
    if (!demoModeOn(ctx.env) || !tag || !ids.length || !ids.every((id) => demoRunTagOf(id) === tag)) {
      throw new HttpError(403, 'This demo passkey signs only your own /demo runs.');
    }
  }
  if (claimedOrganizerId && claimedOrganizerId !== cred.organizerId) throw new HttpError(403, 'That passkey belongs to a different organizer.');
  await organizer(ctx, cred.organizerId);
  const clientOrigin = (() => {
    try {
      return decodeClientDataJSON(a.response.clientDataJSON).origin;
    } catch {
      return '';
    }
  })();
  const exp = expectedFor({ origin: clientOrigin }, ctx.env);
  if (!exp) throw new HttpError(401, 'This passkey was used on a site we don’t recognise.');
  const parts = {
    credentialId: a.id,
    authenticatorData: a.response.authenticatorData,
    clientDataJSON: a.response.clientDataJSON,
    signature: a.response.signature,
    ...(a.response.userHandle ? { userHandle: a.response.userHandle } : {}),
  };
  const v = await verifyApprovalAssertion({ assertion: parts, approvalHash: hash, credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter, kind: 'passkey' }, ...exp, serverNonce: opts.serverNonce });
  if (!v.ok) throw new HttpError(409, `The signature doesn’t cover what’s on screen now (${v.reason}). Review it again.`);
  await touchOrganizerCredential(ctx.db, cred.id, v.newCounter);
  const assertion: ApproverAssertion = {
    v: 1,
    kind: 'passkey',
    ...parts,
    rpId: v.rpId,
    origin: v.origin,
    approvalHash: hash,
    deviceLabel: cred.deviceLabel,
    verifiedAt: new Date().toISOString(),
    ...(opts.serverNonce ? { serverNonce: opts.serverNonce } : {}),
  };
  return { organizerId: cred.organizerId, assertion };
}

/**
 * WebAuthn request options over `hash`, optionally limited to one organizer's passkeys. With a
 * `nonce` the challenge is challengeFor(hash, nonce) and is remembered (single use) for the tap;
 * without one it is the bare hash (policy drafts, whose signatures are re-verified from the audit log).
 */
export async function challengeOptionsFor(ctx: Ctx, hash: string, input: { origin: string | null; organizerId?: string; credentialIds?: string[]; nonce?: string }) {
  const rp = relyingParty(ctx.env, input.origin);
  let allow: Array<{ id: string; transports?: string[] }> | undefined;
  if (input.organizerId) allow = (await listOrganizerCredentials(ctx.db, input.organizerId, { kind: 'passkey' })).filter((c) => !c.boundTo).map((c) => ({ id: c.id, transports: c.transports }));
  if (input.credentialIds?.length) allow = [...(allow ?? []), ...input.credentialIds.map((id) => ({ id }))];
  const challenge = input.nonce
    ? newChallenge({ purpose: 'approve', approvalHash: hash, serverNonce: input.nonce, origin: rp.origin, rpId: rp.rpId }, fromB64url(challengeFor(hash, input.nonce)))
    : hexToBytes(hash);
  return generateAuthenticationOptions({
    rpID: rp.rpId,
    challenge,
    userVerification: 'required',
    ...(allow?.length ? { allowCredentials: allow } : {}),
  });
}

/* ---------------- sessions + revocation ---------------- */

/** A session cookie is only as good as its credential: a revoked passkey signs nobody in. */
export async function liveSession(ctx: Ctx, s: OrganizerSession | null): Promise<OrganizerSession | null> {
  if (!s) return null;
  const cred = await getOrganizerCredential(ctx.db, s.credentialId);
  return cred && cred.organizerId === s.organizerId && !cred.boundTo ? s : null;
}

/**
 * Revoke a passkey (lost phone, someone leaves). Any signed-in organizer of the group may revoke any
 * organizer's passkey, and the audit row names who did. From then on the credential cannot sign in,
 * approve or sign a policy draft, and signatures it made that are not yet acted on stop counting.
 */
export async function revokePasskey(ctx: Ctx, input: { credentialId: string; session: OrganizerSession | null }): Promise<{ organizerId: string; deviceLabel: string; signedOut: boolean }> {
  const me = await liveSession(ctx, input.session);
  if (!me) throw new HttpError(401, 'Sign in with a passkey to revoke a device.');
  const cred = await getOrganizerCredential(ctx.db, input.credentialId);
  if (!cred) throw new HttpError(404, 'That device was already revoked, or was never registered.');
  if (cred.kind !== 'passkey') throw new HttpError(400, 'Demo keys belong to this demo server and can’t be revoked here.');
  const owner = await organizer(ctx, cred.organizerId);
  await revokeOrganizerCredential(ctx.db, { id: cred.id, actor: me.organizerId, reason: owner.id === me.organizerId ? 'revoked by its owner' : `revoked by ${me.name}` });
  return { organizerId: owner.id, deviceLabel: cred.deviceLabel, signedOut: cred.id === me.credentialId };
}
