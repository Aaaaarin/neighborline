/** Domain rows (db) + presentation meta → the view models in lib/types.ts. */
import { hasBlockingFlag, type HelpRequest, type Organizer as DomainOrganizer, type Policy, type RequestStatus } from '@neighborline/core';
import {
  getActivePolicy,
  getBatch,
  getRequest,
  listApprovalsForRequest,
  listItemsForRequest,
  listNotifications,
  listOrganizers,
  listRequests as dbListRequests,
} from '@neighborline/db';
import type { GroupView, Organizer, RequestView, ThreadMessage, ThreadView } from '../../types';
import { QUEUE_PEOPLE } from './demo-extras';
import { categoryLabelFor, type BaseCtx as Ctx } from './context';
import { PAYOUT_PURPOSE } from './constants';
import { listAlerts } from './queries';

export function organizerView(o: DomainOrganizer): Organizer {
  const handle = o.handles.find((h) => h.startsWith('@')) ?? o.handles[0] ?? '';
  return { id: o.id, name: o.name, handle, deviceLabel: `${o.name}'s phone` };
}

export async function groupView(ctx: Ctx): Promise<GroupView> {
  const g = ctx.gen.group;
  const policy = await getActivePolicy(ctx.db, g.id);
  const orgs = await listOrganizers(ctx.db, g.id);
  const simulated = ctx.cfg.paypalMode !== 'sandbox';
  const venmo = g.officialHandles.find((h) => h.wallet === 'VENMO') ?? g.officialHandles[0];
  const alerts = await listAlerts(ctx.db);
  return {
    ...(alerts.length ? { alerts } : {}),
    id: g.id,
    slug: g.slug,
    name: g.name,
    payoutHandle: venmo?.value ?? '',
    fiscalSponsor: {
      name: g.fiscalSponsor.name,
      checks: [
        {
          key: 'business_account',
          label: 'PayPal Business account in the sponsor’s name',
          ok: g.fiscalSponsor.paypalBusinessVerified,
          simulated,
          detail: 'Payouts are sent from the fiscal sponsor’s Business account, never a volunteer’s personal one.',
        },
        {
          key: 'charity_confirmed',
          label: '501(c)(3) status confirmed with PayPal',
          ok: g.fiscalSponsor.charityConfirmed,
          simulated: true,
          detail: 'Confirmed charity status lowers fees and labels donations correctly. Sandbox accounts cannot be confirmed, so this is simulated.',
        },
        {
          key: 'payouts_enabled',
          label: 'Payouts API enabled',
          ok: g.fiscalSponsor.payoutsEnabled,
          simulated,
          detail: 'PayPal enables Payouts on the live Business account after review. In sandbox it is on by default.',
        },
        {
          key: 'purpose_donations',
          label: `Every payout item tagged purpose = ${PAYOUT_PURPOSE}`,
          ok: true,
          simulated: false,
          detail: 'Set explicitly on each Payouts item (PayPal defaults to GOODS), so mutual aid is never labelled as a sale of goods or services.',
        },
        {
          key: 'webhooks_verified',
          label: 'Webhook signatures verified',
          ok: true,
          simulated,
          detail: simulated
            ? 'Every payout status change comes from a webhook whose signature is checked with verify-webhook-signature (here: the local fake PayPal, which signs like PayPal does).'
            : 'Every payout status change comes from a PayPal webhook whose signature we check with verify-webhook-signature before believing it.',
        },
      ],
    },
    organizers: orgs.map(organizerView),
    policy: {
      id: policy?.id ?? '',
      version: policy?.version ?? 0,
      categories: (policy?.categories ?? []).map((c) => ({ key: c.key, label: c.label.en ?? c.key, maxCents: c.maxCents, perHouseholdPer30dCents: c.perHouseholdPer30dCents })),
      householdCapPer30dCents: policy?.householdCapPer30dCents ?? 0,
      dailyBudgetCents: policy?.dailyBudgetCents ?? 0,
      approvalsRequired: g.requiredApprovals,
    },
  };
}

export async function requestView(ctx: Ctx, r: HelpRequest, cache: { policy?: Policy | null; orgs?: DomainOrganizer[] } = {}): Promise<RequestView> {
  const policy = cache.policy !== undefined ? cache.policy : await getActivePolicy(ctx.db, r.groupId);
  const orgs = cache.orgs ?? (await listOrganizers(ctx.db, r.groupId));
  const meta = ctx.meta.get(r.id);
  const seeded = QUEUE_PEOPLE[r.id];
  const approvals = (await listApprovalsForRequest(ctx.db, r.id)).filter((a) => a.status !== 'void').at(-1);
  const items = await listItemsForRequest(ctx.db, r.id);
  const item = items.at(-1);
  const batch = item ? (await getBatch(ctx.db, item.batchId))?.batch : undefined;
  return {
    request: r,
    requester: { displayName: meta?.displayName ?? seeded?.displayName ?? 'Neighbor', ...((meta?.area ?? seeded?.area) ? { area: meta?.area ?? seeded?.area } : {}) },
    categoryLabel: categoryLabelFor(policy, r.computed?.ruleKey ?? r.extracted?.category),
    ...(meta?.audioSeconds ? { audioSeconds: meta.audioSeconds } : {}),
    approvals: (approvals?.approvers ?? []).map((a) => ({
      organizerId: a.organizerId,
      name: orgs.find((o) => o.id === a.organizerId)?.name ?? a.organizerId,
      at: a.at,
      ...(a.assertion ? { signer: { kind: a.assertion.kind, deviceLabel: a.assertion.deviceLabel } } : {}),
    })),
    approvalsRequired: ctx.gen.group.requiredApprovals,
    amountBreakdown: meta?.breakdown ?? null,
    payout: item && batch ? { batch, item } : null,
    ...(meta?.decline ? { decline: meta.decline } : {}),
    ...(meta?.aiTrace ? { aiTrace: meta.aiTrace } : r.extracted ? { aiTrace: { status: 'valid' as const, summary: 'IntakeExtraction valid · filed before this server started' } } : {}),
  };
}

export async function listRequestViews(ctx: Ctx, filter?: { status?: RequestStatus[] }): Promise<RequestView[]> {
  const rows = await dbListRequests(ctx.db, { groupId: ctx.gen.group.id, ...(filter?.status?.length ? { status: filter.status } : {}) });
  const policy = await getActivePolicy(ctx.db, ctx.gen.group.id);
  const orgs = await listOrganizers(ctx.db, ctx.gen.group.id);
  const list = rows.filter((r) => r.extracted).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Promise.all(list.map((r) => requestView(ctx, r, { policy, orgs })));
}

export async function getRequestView(ctx: Ctx, id: string): Promise<RequestView | null> {
  const r = await getRequest(ctx.db, id);
  return r && r.groupId === ctx.gen.group.id ? requestView(ctx, r) : null;
}

const KIND_FOR_KEY: Record<string, ThreadMessage['kind']> = {
  paid: 'paid',
  unclaimed_help: 'claim_help',
  declined_with_appeal: 'declined',
  confirmed_waiting: 'ack',
};

/** The neighbor's thread. Rebuilt from stored text + notifications when this process has no live copy. */
export async function getThread(ctx: Ctx, requestId: string): Promise<ThreadView | null> {
  const r = await getRequest(ctx.db, requestId);
  if (!r || r.groupId !== ctx.gen.group.id) return null;
  const items = await listItemsForRequest(ctx.db, r.id);
  const approvals = (await listApprovalsForRequest(ctx.db, r.id)).filter((a) => a.status !== 'void').at(-1);
  let messages = ctx.meta.get(r.id)?.thread;
  if (!messages) {
    messages = [];
    if (r.originalText) messages.push({ id: `${r.id}_in`, at: r.createdAt, from: 'neighbor', kind: r.channel === 'web_voice' ? 'voice' : 'text', lang: r.lang, text: r.originalText, textEn: r.englishText });
    for (const n of await listNotifications(ctx.db, r.id)) {
      messages.push({ id: n.id, at: n.createdAt, from: 'line', kind: KIND_FOR_KEY[n.messageKey] ?? 'status', lang: n.lang, text: n.text });
    }
  }
  return {
    requestId: r.id,
    lang: r.lang,
    status: r.status,
    itemStatus: items.at(-1)?.status ?? null,
    awaitingConfirmation: r.status === 'intake' && !!r.extracted && !hasBlockingFlag(r.railFlags),
    messages,
    approvalsCount: approvals?.approvers.length ?? 0,
    approvalsRequired: ctx.gen.group.requiredApprovals,
  };
}
