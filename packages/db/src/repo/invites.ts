/**
 * Organizer invite codes (THREAT_MODEL R13): single use, expiring, stored hashed.
 *
 * A code is 20 Crockford base32 characters (100 bits) shown as XXXX-XXXX-XXXX-XXXX-XXXX. Only
 * sha256(normalized code) is stored; the plaintext exists once, in the output of the CLI that made it.
 * `consumeOrganizerInvite` is one conditional UPDATE (unused, unexpired, this organizer) so two
 * enrollments racing on the same code cannot both win; `addOrganizerCredential` calls it inside the
 * transaction that stores the passkey, so a code is spent exactly when a passkey is added.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { organizerInvites, organizers } from '../schema.js';
import { RepoError, inTx, iso, isoOrNull, newId } from '../util.js';
import { appendAudit } from './audit.js';

/** Crockford base32: no I, L, O, U, so a code read aloud or copied by hand is hard to get wrong. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_CODE_LENGTH = 20;
export const INVITE_DEFAULT_TTL_MS = 72 * 3600_000;
export const INVITE_MAX_TTL_MS = 30 * 24 * 3600_000;

export interface OrganizerInvite {
  id: string;
  organizerId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedCredentialId: string | null;
}

type Row = typeof organizerInvites.$inferSelect;
const toInvite = (r: Row): OrganizerInvite => ({
  id: r.id,
  organizerId: r.organizerId,
  createdBy: r.createdBy,
  createdAt: iso(r.createdAt),
  expiresAt: iso(r.expiresAt),
  usedAt: isoOrNull(r.usedAt),
  usedCredentialId: r.usedCredentialId ?? null,
});

/** A fresh code, grouped for reading: 7KQ3-M9XD-2PHT-WC4R-8BNE. 32 symbols divide 256, so every symbol is equally likely. */
export function newInviteCode(): string {
  const out = [...randomBytes(INVITE_CODE_LENGTH)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return out.match(/.{4}/g)!.join('-');
}

/** Uppercase, separators and spaces removed, and the Crockford look-alikes read as digits (O→0, I/L→1). */
export function normalizeInviteCode(code: string): string {
  return code
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export const hashInviteCode = (code: string): string => createHash('sha256').update(normalizeInviteCode(code), 'utf8').digest('hex');

/** "72h", "3d", "90m", or milliseconds as a number. Bounded to 30 days. */
export function parseInviteTtl(ttl: string | number | undefined): number {
  if (ttl === undefined || ttl === '') return INVITE_DEFAULT_TTL_MS;
  let ms: number;
  if (typeof ttl === 'number') ms = ttl;
  else {
    const m = /^\s*(\d+)\s*(m|h|d)\s*$/i.exec(ttl);
    if (!m) throw new RepoError('INVALID', `invite TTL "${ttl}" must look like 90m, 72h or 3d`);
    ms = Number(m[1]) * { m: 60_000, h: 3600_000, d: 86_400_000 }[m[2]!.toLowerCase() as 'm' | 'h' | 'd'];
  }
  if (!Number.isFinite(ms) || ms <= 0) throw new RepoError('INVALID', 'invite TTL must be positive');
  if (ms > INVITE_MAX_TTL_MS) throw new RepoError('INVALID', 'invite TTL can be at most 30 days');
  return ms;
}

/** Make a code for an organizer. Returns the plaintext once; only its hash is stored. Audited (never the code). */
export async function createOrganizerInvite(
  ex: Executor,
  input: { organizerId: string; createdBy: string; ttlMs?: number; now?: Date },
): Promise<{ code: string; invite: OrganizerInvite }> {
  const ttl = parseInviteTtl(input.ttlMs);
  const now = input.now ?? new Date();
  return inTx(ex, async (tx) => {
    const [org] = await tx.select({ id: organizers.id }).from(organizers).where(eq(organizers.id, input.organizerId));
    if (!org) throw new RepoError('NOT_FOUND', `organizer ${input.organizerId} not found`);
    const code = newInviteCode();
    const [row] = await tx
      .insert(organizerInvites)
      .values({ id: newId('inv'), organizerId: input.organizerId, codeHash: hashInviteCode(code), createdBy: input.createdBy, createdAt: now, expiresAt: new Date(now.getTime() + ttl) })
      .returning();
    await appendAudit(tx, {
      actor: input.createdBy,
      action: 'organizer.invite_created',
      entityType: 'organizer',
      entityId: input.organizerId,
      data: { inviteId: row!.id, expiresAt: iso(row!.expiresAt) },
    });
    return { code, invite: toInvite(row!) };
  });
}

/** Is this a live code for this organizer (unused, unexpired)? Does not spend it. */
export async function findLiveOrganizerInvite(ex: Executor, input: { organizerId: string; code: string; now?: Date }): Promise<OrganizerInvite | null> {
  const now = input.now ?? new Date();
  const [row] = await ex
    .select()
    .from(organizerInvites)
    .where(and(eq(organizerInvites.codeHash, hashInviteCode(input.code)), eq(organizerInvites.organizerId, input.organizerId), isNull(organizerInvites.usedAt), gt(organizerInvites.expiresAt, now)));
  return row ? toInvite(row) : null;
}

/**
 * Spend a code: one conditional UPDATE, so of two enrollments racing on the same code exactly one
 * succeeds. Throws RepoError('INVALID') for a wrong, expired, already used or other organizer's code.
 */
export async function consumeOrganizerInvite(
  ex: Executor,
  input: { organizerId: string; code: string; credentialId: string; now?: Date },
): Promise<OrganizerInvite> {
  const now = input.now ?? new Date();
  const [row] = await ex
    .update(organizerInvites)
    .set({ usedAt: now, usedCredentialId: input.credentialId })
    .where(and(eq(organizerInvites.codeHash, hashInviteCode(input.code)), eq(organizerInvites.organizerId, input.organizerId), isNull(organizerInvites.usedAt), gt(organizerInvites.expiresAt, now)))
    .returning();
  if (!row) throw new RepoError('INVALID', 'That invite code is wrong, expired or already used.');
  await appendAudit(ex, {
    actor: input.organizerId,
    action: 'organizer.invite_used',
    entityType: 'organizer',
    entityId: input.organizerId,
    data: { inviteId: row.id, credentialId: input.credentialId },
  });
  return toInvite(row);
}

/** An organizer's invites, newest first (never the codes). */
export async function listOrganizerInvites(ex: Executor, organizerId: string): Promise<OrganizerInvite[]> {
  const rows = await ex.select().from(organizerInvites).where(eq(organizerInvites.organizerId, organizerId)).orderBy(desc(organizerInvites.createdAt));
  return rows.map(toInvite);
}
