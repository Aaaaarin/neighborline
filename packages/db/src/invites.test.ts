import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { DbHandle } from './client.js';
import { listAudit, verifyAuditChain } from './repo/audit.js';
import { addOrganizerCredential, getOrganizerCredential } from './repo/credentials.js';
import {
  consumeOrganizerInvite,
  createOrganizerInvite,
  findLiveOrganizerInvite,
  hashInviteCode,
  INVITE_DEFAULT_TTL_MS,
  listOrganizerInvites,
  newInviteCode,
  normalizeInviteCode,
  parseInviteTtl,
} from './repo/invites.js';
import { rowsOf } from './migrate.js';
import { freshDb, withGroup } from './test-db.js';

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
  await withGroup(h);
});
afterAll(async () => h.close());

let n = 0;
const passkey = (organizerId: string, inviteCode?: string) => ({
  id: `cred_inv_${++n}`,
  organizerId,
  publicKey: 'pk',
  deviceLabel: `device ${n}`,
  kind: 'passkey' as const,
  ...(inviteCode !== undefined ? { inviteCode } : {}),
});

describe('invite codes', () => {
  it('are 100-bit Crockford base32, grouped, and normalize what people type', () => {
    const c = newInviteCode();
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    expect(newInviteCode()).not.toBe(c);
    expect(normalizeInviteCode(' 7kq3-m9xd 2pht_wc4r.8bne ')).toBe('7KQ3M9XD2PHTWC4R8BNE');
    expect(normalizeInviteCode('ab-oi-l')).toBe('AB011');
    expect(hashInviteCode('7kq3-m9xd')).toBe(hashInviteCode('7KQ3M9XD'));
    expect(hashInviteCode('7KQ3M9XD')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TTL: default 72 h, 90m / 72h / 3d, at most 30 days', () => {
    expect(parseInviteTtl(undefined)).toBe(INVITE_DEFAULT_TTL_MS);
    expect(parseInviteTtl('90m')).toBe(90 * 60_000);
    expect(parseInviteTtl('72h')).toBe(72 * 3600_000);
    expect(parseInviteTtl('3d')).toBe(3 * 86_400_000);
    expect(() => parseInviteTtl('31d')).toThrow(/30 days/);
    expect(() => parseInviteTtl('soon')).toThrow(/90m, 72h or 3d/);
    expect(() => parseInviteTtl(0)).toThrow(/positive/);
  });

  it('only the sha256 of the code is stored, never the code', async () => {
    const { code, invite } = await createOrganizerInvite(h.db, { organizerId: 'org_c', createdBy: 'cli' });
    const rows = rowsOf<Record<string, unknown>>(await h.db.execute(sql`SELECT * FROM organizer_invites WHERE id = ${invite.id}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code_hash).toBe(hashInviteCode(code));
    expect(JSON.stringify(rows[0])).not.toContain(normalizeInviteCode(code));
    expect(JSON.stringify(rows[0])).not.toContain(code);
    const audit = (await listAudit(h.db)).filter((a) => a.entityId === 'org_c');
    expect(JSON.stringify(audit)).not.toContain(code);
    expect(audit.some((a) => a.action === 'organizer.invite_created')).toBe(true);
    expect(new Date(invite.expiresAt).getTime() - new Date(invite.createdAt).getTime()).toBe(INVITE_DEFAULT_TTL_MS);
  });

  it('enrollment spends the code with the passkey, exactly once', async () => {
    const { code } = await createOrganizerInvite(h.db, { organizerId: 'org_a', createdBy: 'cli' });
    expect(await findLiveOrganizerInvite(h.db, { organizerId: 'org_a', code })).not.toBeNull();
    const first = passkey('org_a', code);
    await addOrganizerCredential(h.db, first);
    expect(await getOrganizerCredential(h.db, first.id)).not.toBeNull();
    expect(await findLiveOrganizerInvite(h.db, { organizerId: 'org_a', code })).toBeNull();
    const second = passkey('org_a', code);
    await expect(addOrganizerCredential(h.db, second)).rejects.toMatchObject({ code: 'INVALID' });
    expect(await getOrganizerCredential(h.db, second.id)).toBeNull(); // nothing stored without a live code
    const [inv] = await listOrganizerInvites(h.db, 'org_a');
    expect(inv).toMatchObject({ usedCredentialId: first.id });
    expect(inv!.usedAt).not.toBeNull();
  });

  it('two enrollments racing on one code: exactly one wins', async () => {
    const { code } = await createOrganizerInvite(h.db, { organizerId: 'org_b', createdBy: 'cli' });
    const results = await Promise.allSettled([addOrganizerCredential(h.db, passkey('org_b', code)), addOrganizerCredential(h.db, passkey('org_b', code))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it("refuses an expired code, a wrong code and another organizer's code", async () => {
    const now = new Date('2026-10-16T12:00:00Z');
    const { code } = await createOrganizerInvite(h.db, { organizerId: 'org_c', createdBy: 'cli', ttlMs: 3600_000, now });
    const later = new Date(now.getTime() + 3600_000 + 1);
    await expect(consumeOrganizerInvite(h.db, { organizerId: 'org_c', code, credentialId: 'x', now: later })).rejects.toMatchObject({ code: 'INVALID' });
    const { code: fresh } = await createOrganizerInvite(h.db, { organizerId: 'org_c', createdBy: 'cli' });
    await expect(addOrganizerCredential(h.db, passkey('org_a', fresh))).rejects.toMatchObject({ code: 'INVALID' }); // org_c's code
    await expect(addOrganizerCredential(h.db, passkey('org_c', newInviteCode()))).rejects.toMatchObject({ code: 'INVALID' });
    await addOrganizerCredential(h.db, passkey('org_c', fresh.toLowerCase().replace(/-/g, ' '))); // typed loosely, still the code
  });

  it('unknown organizers get no code; the audit chain stays intact', async () => {
    await expect(createOrganizerInvite(h.db, { organizerId: 'org_nobody', createdBy: 'cli' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });
});
