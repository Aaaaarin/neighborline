/** Test helpers: a fresh, migrated in-memory PGlite plus a minimal group fixture. */
import { demoPolicy, type HelpRequest, type PayoutDestination } from '@neighborline/core';
import { createDb, type DbHandle } from './client.js';
import { migrate } from './migrate.js';
import { activatePolicy, createGroup, createOrganizer } from './repo/groups.js';
import { createRequest, updateRequest } from './repo/requests.js';

export async function freshDb(): Promise<DbHandle> {
  const h = createDb({ memory: true });
  await migrate(h.db);
  return h;
}

export const GROUP_ID = 'grp_t';

export async function withGroup(h: DbHandle, opts: { requiredApprovals?: number } = {}) {
  await createGroup(h.db, {
    id: GROUP_ID,
    slug: 'test-group',
    name: 'Test Group',
    officialHandles: [{ wallet: 'VENMO', type: 'USER_HANDLE', value: '@test-group-aid' }],
    fiscalSponsor: { name: 'Sponsor', paypalBusinessVerified: true, payoutsEnabled: true, charityConfirmed: true },
    ...(opts.requiredApprovals ? { requiredApprovals: opts.requiredApprovals } : {}),
  });
  for (const id of ['org_a', 'org_b', 'org_c']) await createOrganizer(h.db, { id, groupId: GROUP_ID, name: id, handles: [`@${id}-handle`] });
  const policy = await activatePolicy(h.db, demoPolicy({ id: 'pol_t1', groupId: GROUP_ID, approvedBy: ['org_a', 'org_b'] }));
  return { policy };
}

let n = 0;
export const venmo = (value: string, nameOnFile?: string): PayoutDestination => ({
  wallet: 'VENMO',
  type: 'USER_HANDLE',
  value,
  ...(nameOnFile ? { nameOnFile } : {}),
});

/** A request already in awaiting_approval with a computed amount. */
export async function readyRequest(
  h: DbHandle,
  over: { amountCents?: number; dest?: PayoutDestination; lang?: HelpRequest['lang']; createdAt?: string; railFlags?: HelpRequest['railFlags'] } = {},
): Promise<HelpRequest> {
  n += 1;
  const r = await createRequest(h.db, {
    id: `req_t${n}`,
    groupId: GROUP_ID,
    channel: 'web_text',
    lang: over.lang ?? 'en',
    originalText: 'help',
    englishText: 'help',
    payoutDestination: over.dest ?? venmo(`@neighbor-${n}`),
    ...(over.createdAt ? { createdAt: over.createdAt } : {}),
  });
  return updateRequest(h.db, r.id, {
    status: 'awaiting_approval',
    confirmedByRequester: true,
    policyVersionId: 'pol_t1',
    computed: { amountCents: over.amountCents ?? 10000, ruleKey: 'groceries', ruleCitation: 'Policy v1 · Groceries', policyVersion: 1 },
    railFlags: over.railFlags ?? [],
  });
}
