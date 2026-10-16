import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvalidTransitionError, demoPolicy } from '@neighborline/core';
import type { DbHandle } from './client.js';
import { listAudit } from './repo/audit.js';
import {
  activatePolicy,
  createGroup,
  getActivePolicy,
  getGroup,
  getGroupBySlug,
  getPolicy,
  getRailHandles,
  listOrganizers,
} from './repo/groups.js';
import {
  countRequestsByStatus,
  createRequest,
  getHistoryForDestination,
  getRequest,
  listRequests,
  updateRequest,
} from './repo/requests.js';
import { GROUP_ID, freshDb, readyRequest, venmo, withGroup } from './test-db.js';

let h: DbHandle;
beforeAll(async () => {
  h = await freshDb();
  await withGroup(h);
});
afterAll(async () => h.close());

describe('groups and organizers', () => {
  it('looks groups up by id and slug', async () => {
    const g = await getGroupBySlug(h.db, 'test-group');
    expect(g).toMatchObject({ id: GROUP_ID, name: 'Test Group', activePolicyId: 'pol_t1', requiredApprovals: 2, timezone: 'America/Los_Angeles' });
    expect(g?.createdAt).toMatch(/Z$/);
    expect(await getGroup(h.db, GROUP_ID)).toEqual(g);
    expect(await getGroupBySlug(h.db, 'nope')).toBeNull();
    expect(await getGroup(h.db, 'nope')).toBeNull();
  });
  it('validates new groups (slug format, ≥2 approvals) and enforces unique slugs', async () => {
    const base = {
      slug: 'Bad Slug!',
      name: 'x',
      officialHandles: [],
      fiscalSponsor: { name: 's', paypalBusinessVerified: false, payoutsEnabled: false, charityConfirmed: false },
    };
    await expect(createGroup(h.db, base)).rejects.toThrow();
    await expect(createGroup(h.db, { ...base, slug: 'ok-slug', requiredApprovals: 1 })).rejects.toThrow();
    await expect(createGroup(h.db, { ...base, slug: 'test-group' })).rejects.toThrow();
  });
  it('lists organizers and rail handles', async () => {
    expect((await listOrganizers(h.db, GROUP_ID)).map((o) => o.id)).toEqual(['org_a', 'org_b', 'org_c']);
    expect(await getRailHandles(h.db, GROUP_ID)).toEqual({
      groupHandles: ['@test-group-aid'],
      organizerHandles: ['@org_a-handle', '@org_b-handle', '@org_c-handle'],
    });
    await expect(getRailHandles(h.db, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('policies', () => {
  it('returns the active policy', async () => {
    const p = await getActivePolicy(h.db, GROUP_ID);
    expect(p?.id).toBe('pol_t1');
    expect(p?.categories).toHaveLength(6);
    expect(await getActivePolicy(h.db, 'nope')).toBeNull();
  });
  it('rejects invalid policies', async () => {
    const bad = { ...demoPolicy({ id: 'pol_bad', groupId: GROUP_ID }), householdCapPer30dCents: 100 };
    await expect(activatePolicy(h.db, bad)).rejects.toMatchObject({ code: 'INVALID' });
  });
  it('requires two distinct organizers of the group', async () => {
    const one = demoPolicy({ id: 'pol_one', groupId: GROUP_ID, approvedBy: ['org_a', 'org_a'] });
    await expect(activatePolicy(h.db, one)).rejects.toThrow(/two organizers/);
    const outsiders = demoPolicy({ id: 'pol_out', groupId: GROUP_ID, approvedBy: ['org_a', 'mallory'] });
    await expect(activatePolicy(h.db, outsiders)).rejects.toThrow(/two organizers/);
  });
  it('activates a new version, retires the old one and keeps policies immutable', async () => {
    const v2 = { ...demoPolicy({ id: 'pol_t2', groupId: GROUP_ID, approvedBy: ['org_b', 'org_c'] }), version: 2 };
    await activatePolicy(h.db, v2, { actor: 'org_b' });
    expect((await getActivePolicy(h.db, GROUP_ID))?.id).toBe('pol_t2');
    expect((await getGroup(h.db, GROUP_ID))?.activePolicyId).toBe('pol_t2');
    expect((await getPolicy(h.db, 'pol_t1'))?.version).toBe(1);
    // same id, different content → conflict
    await expect(activatePolicy(h.db, { ...v2, dailyBudgetCents: 3_000_00 })).rejects.toMatchObject({ code: 'CONFLICT' });
    // roll back to v1 with identical content is allowed
    await activatePolicy(h.db, demoPolicy({ id: 'pol_t1', groupId: GROUP_ID, approvedBy: ['org_a', 'org_b'] }));
    expect((await getActivePolicy(h.db, GROUP_ID))?.id).toBe('pol_t1');
    const actions = (await listAudit(h.db)).filter((e) => e.action === 'policy.activated').map((e) => e.entityId);
    expect(actions).toEqual(['pol_t1', 'pol_t2', 'pol_t1']);
  });
});

describe('requests', () => {
  it('creates with safe defaults and round-trips core types', async () => {
    const r = await createRequest(h.db, { groupId: GROUP_ID, channel: 'web_voice', lang: 'vi', originalText: 'Nhà tôi mất điện', audioRef: 'blob:1', contact: { phone: '+1 555 222 3333' } });
    expect(r).toMatchObject({ status: 'intake', photoRefs: [], extracted: null, payoutDestination: null, computed: null, railFlags: [], confirmedByRequester: false, audioRef: 'blob:1' });
    expect(r.id).toMatch(/^req_[0-9a-f]{20}$/);
    expect(await getRequest(h.db, r.id)).toEqual(r);
    expect(await getRequest(h.db, 'nope')).toBeNull();
  });
  it('rejects invalid input via the core zod contract', async () => {
    await expect(createRequest(h.db, { groupId: GROUP_ID, channel: 'pigeon' as 'sms', lang: 'en' })).rejects.toThrow();
  });
  it('enforces the request state machine on update', async () => {
    const r = await createRequest(h.db, { groupId: GROUP_ID, channel: 'sms', lang: 'es' });
    await expect(updateRequest(h.db, r.id, { status: 'paid' })).rejects.toBeInstanceOf(InvalidTransitionError);
    const r2 = await updateRequest(h.db, r.id, { status: 'needs_clarification' }, { actor: 'intake-agent' });
    expect(r2.status).toBe('needs_clarification');
    const audit = (await listAudit(h.db)).filter((e) => e.entityId === r.id);
    expect(audit.map((e) => [e.actor, e.data])).toEqual([['intake-agent', { from: 'intake', to: 'needs_clarification' }]]);
  });
  it('supports optimistic concurrency with expectStatus', async () => {
    const r = await createRequest(h.db, { groupId: GROUP_ID, channel: 'sms', lang: 'es' });
    await expect(updateRequest(h.db, r.id, { englishText: 'x' }, { expectStatus: 'awaiting_approval' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(updateRequest(h.db, 'missing', { englishText: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const ok = await updateRequest(h.db, r.id, { englishText: 'hello' }, { expectStatus: 'intake' });
    expect(ok.englishText).toBe('hello');
  });
  it('does not let a patch change id, group or createdAt', async () => {
    const r = await createRequest(h.db, { groupId: GROUP_ID, channel: 'sms', lang: 'es' });
    const patch = { id: 'hijack', groupId: 'other', createdAt: '2000-01-01T00:00:00Z', englishText: 'x' } as Parameters<typeof updateRequest>[2];
    const u = await updateRequest(h.db, r.id, patch);
    expect([u.id, u.groupId, u.createdAt]).toEqual([r.id, r.groupId, r.createdAt]);
  });
  it('lists by status (single or many) and counts', async () => {
    const ready = await readyRequest(h);
    const awaiting = await listRequests(h.db, { groupId: GROUP_ID, status: 'awaiting_approval' });
    expect(awaiting.map((r) => r.id)).toContain(ready.id);
    const many = await listRequests(h.db, { status: ['awaiting_approval', 'needs_clarification'] });
    expect(many.every((r) => ['awaiting_approval', 'needs_clarification'].includes(r.status))).toBe(true);
    expect((await listRequests(h.db)).length).toBeGreaterThanOrEqual(many.length);
    const counts = await countRequestsByStatus(h.db, GROUP_ID);
    expect(counts.awaiting_approval).toBe(awaiting.length);
  });
});

describe('getHistoryForDestination', () => {
  const now = new Date('2026-10-16T18:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  it('matches normalized destinations and phones within the window', async () => {
    const d = venmo('@History-Person', 'Hist Person');
    await readyRequest(h, { dest: d, createdAt: ago(3), amountCents: 7000 });
    await readyRequest(h, { dest: venmo('@history-person'), createdAt: ago(10) });
    await readyRequest(h, { dest: d, createdAt: ago(45) }); // outside 30d
    const phoneReq = await createRequest(h.db, {
      groupId: GROUP_ID, channel: 'sms', lang: 'en', createdAt: ago(2),
      payoutDestination: venmo('@different-handle'), contact: { phone: '(555) 777-8888' },
    });
    const hist = await getHistoryForDestination(h.db, venmo(' @HISTORY-PERSON '), 30, { now });
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ ruleKey: 'groceries', status: 'awaiting_approval' });
    expect(hist.map((x) => x.amountCents).sort((a, b) => a - b)).toEqual([7000, 10000]);
    const withPhone = await getHistoryForDestination(h.db, venmo('@history-person'), 30, { now, phone: '+1 555 777 8888', groupId: GROUP_ID });
    expect(withPhone.map((x) => x.requestId)).toContain(phoneReq.id);
    expect(withPhone.find((x) => x.requestId === phoneReq.id)).toMatchObject({ amountCents: 0, ruleKey: 'other', phone: '5557778888' });
    expect(await getHistoryForDestination(h.db, venmo('@history-person'), 60, { now })).toHaveLength(3);
  });
  it('returns nothing without a destination or a usable phone', async () => {
    expect(await getHistoryForDestination(h.db, null)).toEqual([]);
    expect(await getHistoryForDestination(h.db, null, 30, { phone: '12' })).toEqual([]);
  });
});
