/**
 * Independent policy re-check, run by the approver right before it pays.
 *
 * The web app computed each amount when the neighbor confirmed (core.computeAmount + core.checkRail).
 * The approver does not take that on trust: it reads the policy, the payout history, today's
 * committed spend and the official handles from the database itself, and re-runs the same pure core
 * functions. Every approved amount must still be allowed (approved ≤ recomputed) and no block flag
 * may appear. Anything else is refused before PayPal is called.
 *
 * Ordering rule (first come, first served): a request is checked against requests created before
 * it plus the requests earlier in the same batch, so two requests from one household in one batch
 * still respect the household cap together.
 */
import { and, eq, gte, inArray, like, not, notInArray, sql } from 'drizzle-orm';
import {
  checkRail,
  computeAmount,
  formatUsd,
  type Group,
  type HelpRequest,
  type HistoryEntry,
  type Policy,
} from '@neighborline/core';
import { getActivePolicy, getHistoryForDestination, getRailHandles, groups, payoutItems, requests, type Db } from '@neighborline/db';

/** Demo rehearsals on /demo (ids `req_demo_…`) never count against real caps — mirrors the web engine. */
export const DEMO_PREFIX = 'req_demo_';
const NOT_SPENT = ['FAILED', 'RETURNED', 'CANCELED', 'BLOCKED', 'REFUNDED', 'REVERSED'];

export interface RecheckInput {
  group: Group;
  policyVersionId: string;
  /** The approval's requests as stored (amounts are requests.computed.amountCents). */
  requests: HelpRequest[];
  demoMode: boolean;
  now?: Date;
}

export interface RecheckItem {
  requestId: string;
  approvedCents: number;
  allowedCents: number | null;
  ruleKey: string | null;
  blockFlags: string[];
}

export type RecheckResult = { ok: true; policy: Policy; items: RecheckItem[] } | { ok: false; problems: string[]; items: RecheckItem[] };

/**
 * Cents committed today in the group's timezone (payout items that did not bounce + approved requests
 * not yet batched), excluding `excludeIds` (this batch) and, in demo mode, demo rehearsals.
 */
export async function committedTodayCents(db: Db, groupId: string, excludeIds: readonly string[], opts: { demoMode: boolean; now?: Date }): Promise<number> {
  const [g] = await db.select({ tz: groups.timezone }).from(groups).where(eq(groups.id, groupId));
  const tz = g?.tz ?? 'America/Los_Angeles';
  const now = (opts.now ?? new Date()).toISOString();
  const startOfDay = sql`(date_trunc('day', ${now}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  const notThese = excludeIds.length ? [not(inArray(requests.id, [...excludeIds]))] : [];
  const notDemo = opts.demoMode ? [not(like(requests.id, `${DEMO_PREFIX}%`))] : [];
  const [items] = await db
    .select({ total: sql<string | number | null>`coalesce(sum(${payoutItems.amountCents}), 0)` })
    .from(payoutItems)
    .innerJoin(requests, eq(requests.id, payoutItems.requestId))
    .where(and(eq(requests.groupId, groupId), gte(payoutItems.createdAt, startOfDay), notInArray(payoutItems.status, NOT_SPENT), ...notThese, ...notDemo));
  const [approved] = await db
    .select({ total: sql<string | number | null>`coalesce(sum(${requests.amountCents}), 0)` })
    .from(requests)
    .where(and(eq(requests.groupId, groupId), eq(requests.status, 'approved'), gte(requests.updatedAt, startOfDay), ...notThese, ...notDemo));
  return Number(items?.total ?? 0) + Number(approved?.total ?? 0);
}

export async function recheckPolicy(db: Db, input: RecheckInput): Promise<RecheckResult> {
  const now = input.now ?? new Date();
  const problems: string[] = [];
  const items: RecheckItem[] = [];
  const policy = await getActivePolicy(db, input.group.id);
  if (!policy) return { ok: false, problems: ['the group has no active policy'], items };
  if (policy.id !== input.policyVersionId) {
    return { ok: false, problems: [`approved under policy ${input.policyVersionId}, but the active policy is now ${policy.id} (v${policy.version}); approve again`], items };
  }
  const batchIds = input.requests.map((r) => r.id);
  const handles = await getRailHandles(db, input.group.id);
  let today = await committedTodayCents(db, input.group.id, batchIds, { demoMode: input.demoMode, now });
  const earlier: HistoryEntry[] = [];

  const ordered = [...input.requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const r of ordered) {
    const approvedCents = r.computed?.amountCents ?? 0;
    const item: RecheckItem = { requestId: r.id, approvedCents, allowedCents: null, ruleKey: null, blockFlags: [] };
    items.push(item);
    const dest = r.payoutDestination;
    if (!dest || !r.extracted || approvedCents <= 0) {
      problems.push(`${r.id}: no destination, extraction or amount on record`);
      continue;
    }
    const phone = r.contact?.phone ?? r.contact?.whatsapp;
    const stored = await getHistoryForDestination(db, dest, 30, { groupId: r.groupId, ...(phone ? { phone } : {}), now });
    const history = [
      ...stored.filter(
        (h) => !batchIds.includes(h.requestId) && h.createdAt < r.createdAt && !(input.demoMode && h.requestId.startsWith(DEMO_PREFIX)),
      ),
      ...earlier,
    ];
    const amount = computeAmount({
      policy,
      extraction: r.extracted,
      history,
      todaySpentCents: today,
      destination: dest,
      ...(phone ? { phone } : {}),
      now,
      requestId: r.id,
    });
    const flags = checkRail({
      destination: dest,
      groupHandles: handles.groupHandles,
      organizerHandles: handles.organizerHandles,
      history,
      policy,
      text: [r.originalText, r.englishText],
      now,
      requestId: r.id,
    });
    if (!amount.ok) flags.push(...amount.flags);
    item.blockFlags = [...new Set(flags.filter((f) => f.severity === 'block').map((f) => f.code))];
    if (item.blockFlags.length) problems.push(`${r.id}: blocked by rail protection (${item.blockFlags.join(', ')})`);
    if (amount.ok) {
      item.allowedCents = amount.computed.amountCents;
      item.ruleKey = amount.computed.ruleKey;
      if (r.computed?.ruleKey && amount.computed.ruleKey !== r.computed.ruleKey) {
        problems.push(`${r.id}: approved under rule "${r.computed.ruleKey}" but the policy now files it under "${amount.computed.ruleKey}"`);
      }
      if (approvedCents > amount.computed.amountCents) {
        problems.push(`${r.id}: approved ${formatUsd(approvedCents)} but the policy allows at most ${formatUsd(amount.computed.amountCents)} right now`);
      }
    }
    // Later requests in this batch see this one as already committed.
    earlier.push({ requestId: r.id, createdAt: r.createdAt, ruleKey: r.computed?.ruleKey ?? 'other', amountCents: approvedCents, status: 'approved', destination: dest, ...(phone ? { phone } : {}) });
    if (!(input.demoMode && r.id.startsWith(DEMO_PREFIX))) today += approvedCents;
  }
  return problems.length ? { ok: false, problems, items } : { ok: true, policy, items };
}
