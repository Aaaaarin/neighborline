/** Help requests: create, update (state-machine enforced), list, and household history. */
import { and, asc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  HelpRequest,
  destinationKey,
  normalizePhone,
  transitionRequest,
  type HistoryEntry,
  type PayoutDestination,
  type RequestStatus,
} from '@neighborline/core';
import type { Executor } from '../client.js';
import { requests } from '../schema.js';
import { RepoError, inTx, iso, newId } from '../util.js';
import { appendAudit } from './audit.js';

type Row = typeof requests.$inferSelect;

export function toHelpRequest(r: Row): HelpRequest {
  return {
    id: r.id,
    groupId: r.groupId,
    createdAt: iso(r.createdAt),
    channel: r.channel as HelpRequest['channel'],
    lang: r.lang as HelpRequest['lang'],
    originalText: r.originalText,
    englishText: r.englishText,
    ...(r.audioRef ? { audioRef: r.audioRef } : {}),
    photoRefs: r.photoRefs,
    extracted: r.extracted ?? null,
    confirmedByRequester: r.confirmedByRequester,
    payoutDestination: r.payoutDestination ?? null,
    status: r.status as RequestStatus,
    policyVersionId: r.policyVersionId,
    computed: r.computed ?? null,
    railFlags: r.railFlags,
    ...(r.contact ? { contact: r.contact } : {}),
  };
}

/** Columns derived from the request body (kept in sync on every write). */
function derived(req: HelpRequest) {
  const phone = req.contact?.phone ?? req.contact?.whatsapp;
  return {
    destinationKey: req.payoutDestination ? destinationKey(req.payoutDestination) : null,
    phoneKey: phone ? normalizePhone(phone) || null : null,
    ruleKey: req.computed?.ruleKey ?? null,
    amountCents: req.computed?.amountCents ?? null,
  };
}

function toValues(req: HelpRequest) {
  return {
    groupId: req.groupId,
    channel: req.channel,
    lang: req.lang,
    originalText: req.originalText,
    englishText: req.englishText,
    audioRef: req.audioRef ?? null,
    photoRefs: req.photoRefs,
    extracted: req.extracted,
    confirmedByRequester: req.confirmedByRequester,
    payoutDestination: req.payoutDestination,
    status: req.status,
    policyVersionId: req.policyVersionId,
    computed: req.computed,
    railFlags: req.railFlags,
    contact: req.contact ?? null,
    ...derived(req),
  };
}

export type NewRequest = Pick<HelpRequest, 'groupId' | 'channel' | 'lang'> &
  Partial<Omit<HelpRequest, 'groupId' | 'channel' | 'lang'>>;

export async function createRequest(ex: Executor, input: NewRequest): Promise<HelpRequest> {
  const req = HelpRequest.parse({
    originalText: '',
    englishText: '',
    photoRefs: [],
    extracted: null,
    confirmedByRequester: false,
    payoutDestination: null,
    status: 'intake',
    policyVersionId: null,
    computed: null,
    railFlags: [],
    ...input,
    id: input.id ?? newId('req'),
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  const createdAt = new Date(req.createdAt);
  const [row] = await ex
    .insert(requests)
    .values({ id: req.id, createdAt, updatedAt: createdAt, ...toValues(req) })
    .returning();
  return toHelpRequest(row as Row);
}

export async function getRequest(ex: Executor, id: string): Promise<HelpRequest | null> {
  const [row] = await ex.select().from(requests).where(eq(requests.id, id));
  return row ? toHelpRequest(row) : null;
}

export type RequestPatch = Partial<Omit<HelpRequest, 'id' | 'groupId' | 'createdAt'>>;

/**
 * Patch a request. Status changes go through the core state machine (throws
 * InvalidTransitionError). `expectStatus` gives optimistic concurrency for UI actions.
 */
export async function updateRequest(
  ex: Executor,
  id: string,
  patch: RequestPatch,
  opts: { expectStatus?: RequestStatus; actor?: string; at?: Date } = {},
): Promise<HelpRequest> {
  return inTx(ex, async (tx) => {
    const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for('update');
    if (!row) throw new RepoError('NOT_FOUND', `request ${id} not found`);
    const current = toHelpRequest(row);
    if (opts.expectStatus && current.status !== opts.expectStatus) {
      throw new RepoError('CONFLICT', `request ${id} is ${current.status}, expected ${opts.expectStatus}`);
    }
    const next = HelpRequest.parse({ ...current, ...patch, id: current.id, groupId: current.groupId, createdAt: current.createdAt });
    if (next.status !== current.status) transitionRequest(current.status, next.status);
    const [updated] = await tx
      .update(requests)
      .set({ ...toValues(next), updatedAt: opts.at ?? new Date() })
      .where(eq(requests.id, id))
      .returning();
    if (next.status !== current.status) {
      await appendAudit(tx, {
        actor: opts.actor ?? 'system',
        action: 'request.status',
        entityType: 'request',
        entityId: id,
        data: { from: current.status, to: next.status },
        ...(opts.at ? { at: opts.at } : {}),
      });
    }
    return toHelpRequest(updated as Row);
  });
}

export async function listRequests(
  ex: Executor,
  filter: { groupId?: string; status?: RequestStatus | readonly RequestStatus[] } = {},
): Promise<HelpRequest[]> {
  const conds: SQL[] = [];
  if (filter.groupId) conds.push(eq(requests.groupId, filter.groupId));
  if (filter.status) {
    const statuses = typeof filter.status === 'string' ? [filter.status] : [...filter.status];
    conds.push(inArray(requests.status, statuses));
  }
  const rows = await ex
    .select()
    .from(requests)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(requests.createdAt), asc(requests.id));
  return rows.map(toHelpRequest);
}

/**
 * Prior requests to the same payout destination (or phone) within `sinceDays`, as core
 * HistoryEntry rows for computeAmount/checkRail. Returns all statuses; core decides what counts.
 */
export async function getHistoryForDestination(
  ex: Executor,
  destination: Pick<PayoutDestination, 'type' | 'value'> | null,
  sinceDays = 30,
  opts: { phone?: string; groupId?: string; now?: Date } = {},
): Promise<HistoryEntry[]> {
  const keys: SQL[] = [];
  if (destination) keys.push(eq(requests.destinationKey, destinationKey(destination)));
  const phone = opts.phone ? normalizePhone(opts.phone) : '';
  if (phone.length >= 7) keys.push(eq(requests.phoneKey, phone));
  if (keys.length === 0) return [];
  const since = new Date((opts.now ?? new Date()).getTime() - sinceDays * 86_400_000);
  const conds: SQL[] = [or(...keys) as SQL, gt(requests.createdAt, since)];
  if (opts.groupId) conds.push(eq(requests.groupId, opts.groupId));
  const rows = await ex.select().from(requests).where(and(...conds)).orderBy(asc(requests.createdAt));
  return rows
    .filter((r) => r.payoutDestination)
    .map((r) => ({
      requestId: r.id,
      createdAt: iso(r.createdAt),
      ruleKey: r.ruleKey ?? 'other',
      amountCents: r.amountCents ?? 0,
      status: r.status as RequestStatus,
      destination: r.payoutDestination as PayoutDestination,
      ...(r.phoneKey ? { phone: r.phoneKey } : {}),
    }));
}

/** Count of requests per status for a group (organizer queue badges). */
export async function countRequestsByStatus(ex: Executor, groupId: string): Promise<Partial<Record<RequestStatus, number>>> {
  const rows = await ex
    .select({ status: requests.status, n: sql<number>`count(*)::int` })
    .from(requests)
    .where(eq(requests.groupId, groupId))
    .groupBy(requests.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
