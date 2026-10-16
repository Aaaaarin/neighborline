/**
 * Organizer passkeys (WebAuthn public keys) and the assertions organizers make over approval
 * hashes. Signature verification happens in @neighborline/passkeys before anything is recorded;
 * this module only stores and returns what was verified, with an audit row for each.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { ApproverAssertion } from '@neighborline/core';
import type { Executor } from '../client.js';
import { approvalAssertions, organizerCredentials, organizers } from '../schema.js';
import { RepoError, inTx, iso, isoOrNull } from '../util.js';
import { appendAudit } from './audit.js';

export type CredentialKind = 'passkey' | 'demo_key';

export interface OrganizerCredential {
  id: string;
  organizerId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceLabel: string;
  kind: CredentialKind;
  backedUp: boolean;
  /** 'demo-visitor:<tag>' for a /demo visitor's passkey (signs only that visitor's demo runs); null otherwise. */
  boundTo: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

type Row = typeof organizerCredentials.$inferSelect;
const toCredential = (r: Row): OrganizerCredential => ({
  id: r.id,
  organizerId: r.organizerId,
  publicKey: r.publicKey,
  counter: r.counter,
  transports: r.transports,
  deviceLabel: r.deviceLabel,
  kind: r.kind,
  backedUp: r.backedUp,
  boundTo: r.boundTo ?? null,
  createdAt: iso(r.createdAt),
  lastUsedAt: isoOrNull(r.lastUsedAt),
});

/** Store a verified credential. Idempotent for the same id + organizer; another organizer's id is a conflict. */
export async function addOrganizerCredential(
  ex: Executor,
  input: Omit<OrganizerCredential, 'createdAt' | 'lastUsedAt' | 'counter' | 'transports' | 'backedUp' | 'boundTo'> & { counter?: number; transports?: string[]; backedUp?: boolean; boundTo?: string | null; actor?: string },
): Promise<OrganizerCredential> {
  return inTx(ex, async (tx) => {
    const [org] = await tx.select({ id: organizers.id }).from(organizers).where(eq(organizers.id, input.organizerId));
    if (!org) throw new RepoError('NOT_FOUND', `organizer ${input.organizerId} not found`);
    const [existing] = await tx.select().from(organizerCredentials).where(eq(organizerCredentials.id, input.id));
    if (existing) {
      if (existing.organizerId !== input.organizerId) throw new RepoError('CONFLICT', 'credential belongs to another organizer');
      return toCredential(existing);
    }
    const [row] = await tx
      .insert(organizerCredentials)
      .values({
        id: input.id,
        organizerId: input.organizerId,
        publicKey: input.publicKey,
        counter: input.counter ?? 0,
        transports: input.transports ?? [],
        deviceLabel: input.deviceLabel,
        kind: input.kind,
        backedUp: input.backedUp ?? false,
        boundTo: input.boundTo ?? null,
      })
      .returning();
    await appendAudit(tx, {
      actor: input.actor ?? input.organizerId,
      action: input.kind === 'demo_key' ? 'organizer.demo_key_added' : 'organizer.passkey_added',
      entityType: 'organizer',
      entityId: input.organizerId,
      data: { credentialId: input.id, kind: input.kind, deviceLabel: input.deviceLabel, ...(input.boundTo ? { boundTo: input.boundTo } : {}) },
    });
    return toCredential(row!);
  });
}

export async function getOrganizerCredential(ex: Executor, id: string): Promise<OrganizerCredential | null> {
  const [row] = await ex.select().from(organizerCredentials).where(and(eq(organizerCredentials.id, id), isNull(organizerCredentials.revokedAt)));
  return row ? toCredential(row) : null;
}

export async function listOrganizerCredentials(ex: Executor, organizerId: string, opts: { kind?: CredentialKind } = {}): Promise<OrganizerCredential[]> {
  const rows = await ex
    .select()
    .from(organizerCredentials)
    .where(
      and(
        eq(organizerCredentials.organizerId, organizerId),
        isNull(organizerCredentials.revokedAt),
        ...(opts.kind ? [eq(organizerCredentials.kind, opts.kind)] : []),
      ),
    )
    .orderBy(asc(organizerCredentials.createdAt));
  return rows.map(toCredential);
}

/**
 * Revoke a credential (lost phone, organizer leaves). Sets revoked_at; from then on
 * getOrganizerCredential returns null, so the web app refuses its taps and sign-ins and the approval
 * service refuses any approval it signed that has not been paid yet. Idempotent.
 */
export async function revokeOrganizerCredential(
  ex: Executor,
  input: { id: string; actor: string; reason?: string; at?: Date },
): Promise<{ credential: OrganizerCredential; revokedAt: string; changed: boolean }> {
  return inTx(ex, async (tx) => {
    const [row] = await tx.select().from(organizerCredentials).where(eq(organizerCredentials.id, input.id)).for('update');
    if (!row) throw new RepoError('NOT_FOUND', 'unknown credential');
    if (row.revokedAt) return { credential: toCredential(row), revokedAt: iso(row.revokedAt), changed: false };
    const at = input.at ?? new Date();
    await tx.update(organizerCredentials).set({ revokedAt: at }).where(eq(organizerCredentials.id, input.id));
    await appendAudit(tx, {
      actor: input.actor,
      action: row.kind === 'demo_key' ? 'organizer.demo_key_revoked' : 'organizer.passkey_revoked',
      entityType: 'organizer',
      entityId: row.organizerId,
      data: { credentialId: row.id, kind: row.kind, deviceLabel: row.deviceLabel, ...(input.reason ? { reason: input.reason } : {}) },
      at,
    });
    return { credential: toCredential(row), revokedAt: iso(at), changed: true };
  });
}

/** After a successful assertion: remember the authenticator's signature counter. */
export async function touchOrganizerCredential(ex: Executor, id: string, counter: number, at = new Date()): Promise<void> {
  await ex.update(organizerCredentials).set({ counter, lastUsedAt: at }).where(eq(organizerCredentials.id, id));
}

/**
 * Record a verified assertion over an approval hash. First signature per (hash, organizer) wins;
 * a double tap returns the stored one. The credential must belong to the organizer.
 */
export async function recordApprovalAssertion(
  ex: Executor,
  input: { organizerId: string; assertion: ApproverAssertion },
): Promise<{ assertion: ApproverAssertion; created: boolean }> {
  const a = input.assertion;
  return inTx(ex, async (tx) => {
    const [cred] = await tx.select().from(organizerCredentials).where(eq(organizerCredentials.id, a.credentialId));
    if (!cred || cred.revokedAt) throw new RepoError('NOT_FOUND', 'unknown credential');
    if (cred.organizerId !== input.organizerId) throw new RepoError('CONFLICT', 'credential belongs to another organizer');
    if (cred.kind !== a.kind) throw new RepoError('INVALID', 'assertion kind does not match the credential');
    const inserted = await tx
      .insert(approvalAssertions)
      .values({
        approvalHash: a.approvalHash,
        organizerId: input.organizerId,
        credentialId: a.credentialId,
        kind: a.kind,
        authenticatorData: a.authenticatorData,
        clientDataJson: a.clientDataJSON,
        signature: a.signature,
        userHandle: a.userHandle ?? null,
        rpId: a.rpId,
        origin: a.origin,
        deviceLabel: a.deviceLabel,
        verifiedAt: new Date(a.verifiedAt),
        serverNonce: a.serverNonce ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      await appendAudit(tx, {
        actor: input.organizerId,
        action: a.kind === 'demo_key' ? 'approval.signed_with_demo_key' : 'approval.signed_with_passkey',
        entityType: 'approval_hash',
        entityId: a.approvalHash,
        data: { credentialId: a.credentialId, kind: a.kind, deviceLabel: a.deviceLabel, origin: a.origin, rpId: a.rpId },
      });
      return { assertion: a, created: true };
    }
    const stored = (await listApprovalAssertions(tx, a.approvalHash)).get(input.organizerId);
    return { assertion: stored ?? a, created: false };
  });
}

type ARow = typeof approvalAssertions.$inferSelect;
const toAssertion = (r: ARow): ApproverAssertion => ({
  v: 1,
  kind: r.kind,
  credentialId: r.credentialId,
  authenticatorData: r.authenticatorData,
  clientDataJSON: r.clientDataJson,
  signature: r.signature,
  ...(r.userHandle ? { userHandle: r.userHandle } : {}),
  rpId: r.rpId,
  origin: r.origin,
  approvalHash: r.approvalHash,
  deviceLabel: r.deviceLabel,
  verifiedAt: iso(r.verifiedAt),
  ...(r.serverNonce ? { serverNonce: r.serverNonce } : {}),
});

/** Assertions over one approval hash, by organizer id. */
export async function listApprovalAssertions(ex: Executor, approvalHash: string): Promise<Map<string, ApproverAssertion>> {
  const rows = await ex.select().from(approvalAssertions).where(eq(approvalAssertions.approvalHash, approvalHash));
  return new Map(rows.map((r) => [r.organizerId, toAssertion(r)]));
}

/** Same, for several hashes at once (views). */
export async function listApprovalAssertionsFor(ex: Executor, hashes: readonly string[]): Promise<Map<string, Map<string, ApproverAssertion>>> {
  const out = new Map<string, Map<string, ApproverAssertion>>();
  if (!hashes.length) return out;
  const rows = await ex.select().from(approvalAssertions).where(inArray(approvalAssertions.approvalHash, [...new Set(hashes)]));
  for (const r of rows) {
    const m = out.get(r.approvalHash) ?? new Map<string, ApproverAssertion>();
    m.set(r.organizerId, toAssertion(r));
    out.set(r.approvalHash, m);
  }
  return out;
}
