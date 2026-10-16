/** Groups, organizers and policies. */
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  Group,
  Organizer,
  canonicalJson,
  validatePolicy,
  type FiscalSponsor,
  type Lang,
  type OfficialHandle,
  type Policy,
} from '@neighborline/core';
import type { Executor } from '../client.js';
import { groups, organizers, policies } from '../schema.js';
import { RepoError, inTx, iso, newId } from '../util.js';
import { appendAudit } from './audit.js';

const toGroup = (r: typeof groups.$inferSelect): Group => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  officialHandles: r.officialHandles,
  fiscalSponsor: r.fiscalSponsor,
  activePolicyId: r.activePolicyId,
  timezone: r.timezone,
  requiredApprovals: r.requiredApprovals,
  createdAt: iso(r.createdAt),
});

const toOrganizer = (r: typeof organizers.$inferSelect): Organizer => ({
  id: r.id,
  groupId: r.groupId,
  name: r.name,
  handles: r.handles,
  lang: r.lang as Lang,
  createdAt: iso(r.createdAt),
});

export interface NewGroup {
  id?: string;
  slug: string;
  name: string;
  officialHandles: OfficialHandle[];
  fiscalSponsor: FiscalSponsor;
  timezone?: string;
  requiredApprovals?: number;
}

export async function createGroup(ex: Executor, input: NewGroup): Promise<Group> {
  const candidate = Group.parse({
    id: input.id ?? newId('grp'),
    slug: input.slug,
    name: input.name,
    officialHandles: input.officialHandles,
    fiscalSponsor: input.fiscalSponsor,
    activePolicyId: null,
    timezone: input.timezone ?? 'America/Los_Angeles',
    requiredApprovals: input.requiredApprovals ?? 2,
    createdAt: new Date().toISOString(),
  });
  const { createdAt: _c, ...values } = candidate;
  const [row] = await ex.insert(groups).values(values).returning();
  return toGroup(row as typeof groups.$inferSelect);
}

export async function getGroup(ex: Executor, id: string): Promise<Group | null> {
  const [row] = await ex.select().from(groups).where(eq(groups.id, id));
  return row ? toGroup(row) : null;
}

export async function getGroupBySlug(ex: Executor, slug: string): Promise<Group | null> {
  const [row] = await ex.select().from(groups).where(eq(groups.slug, slug));
  return row ? toGroup(row) : null;
}

export async function createOrganizer(
  ex: Executor,
  input: { id?: string; groupId: string; name: string; handles: string[]; lang?: Lang },
): Promise<Organizer> {
  const [row] = await ex
    .insert(organizers)
    .values({ id: input.id ?? newId('org'), groupId: input.groupId, name: input.name, handles: input.handles, lang: input.lang ?? 'en' })
    .returning();
  return toOrganizer(row as typeof organizers.$inferSelect);
}

export async function listOrganizers(ex: Executor, groupId: string): Promise<Organizer[]> {
  const rows = await ex.select().from(organizers).where(eq(organizers.groupId, groupId)).orderBy(asc(organizers.name));
  return rows.map(toOrganizer);
}

/** Rail-check inputs for a group: its official handle values and every organizer handle. */
export async function getRailHandles(ex: Executor, groupId: string): Promise<{ groupHandles: string[]; organizerHandles: string[] }> {
  const g = await getGroup(ex, groupId);
  if (!g) throw new RepoError('NOT_FOUND', `group ${groupId} not found`);
  const orgs = await listOrganizers(ex, groupId);
  return { groupHandles: g.officialHandles.map((h) => h.value), organizerHandles: orgs.flatMap((o) => o.handles) };
}

/**
 * Store (if new) and activate a policy version. Requires a valid policy and ≥2 distinct
 * approving organizers of the same group (SPEC §6: policies need two organizer approvals).
 * Previous active version is retired. Policies are immutable: re-activating an existing id
 * with different content is rejected.
 */
export async function activatePolicy(ex: Executor, policy: Policy, opts: { actor?: string } = {}): Promise<Policy> {
  const v = validatePolicy(policy);
  if (!v.ok) throw new RepoError('INVALID', v.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  const p = v.policy;
  return inTx(ex, async (tx) => {
    const orgIds = new Set((await listOrganizers(tx, p.groupId)).map((o) => o.id));
    const approvers = new Set(p.approvedBy.filter((id) => orgIds.has(id)));
    if (approvers.size < 2) throw new RepoError('INVALID', 'a policy needs approval from at least two organizers of the group');

    const [existing] = await tx.select().from(policies).where(eq(policies.id, p.id));
    if (existing && canonicalJson(existing.body) !== canonicalJson(p)) {
      throw new RepoError('CONFLICT', `policy ${p.id} already exists with different content (policies are immutable)`);
    }
    await tx
      .update(policies)
      .set({ status: 'retired' })
      .where(and(eq(policies.groupId, p.groupId), eq(policies.status, 'active'), ne(policies.id, p.id)));
    if (existing) {
      await tx.update(policies).set({ status: 'active', activatedAt: new Date() }).where(eq(policies.id, p.id));
    } else {
      await tx.insert(policies).values({
        id: p.id,
        groupId: p.groupId,
        version: p.version,
        body: p,
        status: 'active',
        createdAt: new Date(p.createdAt),
        activatedAt: new Date(),
      });
    }
    await tx.update(groups).set({ activePolicyId: p.id }).where(eq(groups.id, p.groupId));
    await appendAudit(tx, {
      actor: opts.actor ?? 'system',
      action: 'policy.activated',
      entityType: 'policy',
      entityId: p.id,
      data: { groupId: p.groupId, version: p.version, approvedBy: [...approvers].sort() },
    });
    return p;
  });
}

export async function getActivePolicy(ex: Executor, groupId: string): Promise<Policy | null> {
  const [row] = await ex
    .select()
    .from(policies)
    .where(and(eq(policies.groupId, groupId), eq(policies.status, 'active')));
  return row ? row.body : null;
}

export async function getPolicy(ex: Executor, id: string): Promise<Policy | null> {
  const [row] = await ex.select().from(policies).where(eq(policies.id, id));
  return row ? row.body : null;
}
