/**
 * Drizzle schema. Money columns are integer cents; JSON columns hold zod-validated core types.
 * Timestamps are timestamptz (mode 'date') and are mapped to ISO strings at the repo boundary.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  ComputedAmount,
  FiscalSponsor,
  IntakeExtraction,
  OfficialHandle,
  PayoutDestination,
  Policy,
  RailFlag,
} from '@neighborline/core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  officialHandles: jsonb('official_handles').$type<OfficialHandle[]>().notNull(),
  fiscalSponsor: jsonb('fiscal_sponsor').$type<FiscalSponsor>().notNull(),
  activePolicyId: text('active_policy_id'),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
  requiredApprovals: integer('required_approvals').notNull().default(2),
  createdAt: createdAt(),
});

export const organizers = pgTable(
  'organizers',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => groups.id),
    name: text('name').notNull(),
    handles: jsonb('handles').$type<string[]>().notNull(),
    lang: text('lang').notNull().default('en'),
    createdAt: createdAt(),
  },
  (t) => [index('organizers_group_idx').on(t.groupId)],
);

export const policies = pgTable(
  'policies',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => groups.id),
    version: integer('version').notNull(),
    body: jsonb('body').$type<Policy>().notNull(),
    status: text('status').$type<'draft' | 'active' | 'retired'>().notNull().default('draft'),
    createdAt: createdAt(),
    activatedAt: ts('activated_at'),
  },
  (t) => [
    uniqueIndex('policies_group_version_uq').on(t.groupId, t.version),
    // at most one active policy per group
    uniqueIndex('policies_one_active_uq').on(t.groupId).where(sql`${t.status} = 'active'`),
  ],
);

export const requests = pgTable(
  'requests',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => groups.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    channel: text('channel').notNull(),
    lang: text('lang').notNull(),
    originalText: text('original_text').notNull().default(''),
    englishText: text('english_text').notNull().default(''),
    audioRef: text('audio_ref'),
    photoRefs: jsonb('photo_refs').$type<string[]>().notNull().default([]),
    extracted: jsonb('extracted').$type<IntakeExtraction | null>(),
    confirmedByRequester: boolean('confirmed_by_requester').notNull().default(false),
    payoutDestination: jsonb('payout_destination').$type<PayoutDestination | null>(),
    /** Normalized destination (core destinationKey) for household/velocity lookups. */
    destinationKey: text('destination_key'),
    /** Normalized phone (digits) for household lookups. */
    phoneKey: text('phone_key'),
    status: text('status').notNull(),
    policyVersionId: text('policy_version_id'),
    computed: jsonb('computed').$type<ComputedAmount | null>(),
    ruleKey: text('rule_key'),
    amountCents: integer('amount_cents'),
    railFlags: jsonb('rail_flags').$type<RailFlag[]>().notNull().default([]),
    contact: jsonb('contact').$type<{ phone?: string; whatsapp?: string } | null>(),
  },
  (t) => [
    index('requests_group_status_idx').on(t.groupId, t.status),
    index('requests_destination_idx').on(t.destinationKey, t.createdAt),
    index('requests_phone_idx').on(t.phoneKey, t.createdAt),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => groups.id),
    requestIds: jsonb('request_ids').$type<string[]>().notNull(),
    totalCents: integer('total_cents').notNull(),
    policyVersionId: text('policy_version_id').notNull(),
    hash: text('hash').notNull(),
    status: text('status').$type<'pending' | 'complete' | 'executed' | 'void'>().notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  // one live approval per content hash (a voided one may be re-created)
  (t) => [uniqueIndex('approvals_live_hash_uq').on(t.hash).where(sql`${t.status} <> 'void'`)],
);

/** One row per organizer signature; the PK makes "two distinct organizers" a database guarantee. */
export const approvalSignatures = pgTable(
  'approval_signatures',
  {
    approvalId: text('approval_id').notNull().references(() => approvals.id),
    organizerId: text('organizer_id').notNull().references(() => organizers.id),
    at: ts('at').notNull(),
    deviceLabel: text('device_label').notNull(),
  },
  (t) => [primaryKey({ columns: [t.approvalId, t.organizerId] })],
);

export const payoutBatches = pgTable('payout_batches', {
  id: text('id').primaryKey(),
  approvalId: text('approval_id').notNull().unique().references(() => approvals.id),
  senderBatchId: text('sender_batch_id').notNull().unique(),
  paypalBatchId: text('paypal_batch_id').unique(),
  status: text('status').notNull().default('CREATING'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const payoutItems = pgTable(
  'payout_items',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull().references(() => payoutBatches.id),
    requestId: text('request_id').notNull().references(() => requests.id),
    senderItemId: text('sender_item_id').notNull().unique(),
    paypalItemId: text('paypal_item_id').unique(),
    amountCents: integer('amount_cents').notNull(),
    wallet: text('wallet').notNull(),
    receiver: text('receiver').notNull(),
    recipientType: text('recipient_type').notNull(),
    status: text('status').notNull().default('PENDING'),
    transactionId: text('transaction_id'),
    wasUnclaimed: boolean('was_unclaimed').notNull().default(false),
    successAt: ts('success_at'),
    lastEventAt: ts('last_event_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('payout_items_request_idx').on(t.requestId), index('payout_items_created_idx').on(t.createdAt)],
);

export const donations = pgTable(
  'donations',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => groups.id),
    amountCents: integer('amount_cents').notNull(),
    source: text('source').notNull(),
    donorKey: text('donor_key'),
    paypalOrderId: text('paypal_order_id').unique(),
    paypalSubscriptionId: text('paypal_subscription_id'),
    transactionId: text('transaction_id').unique(),
    status: text('status').notNull().default('COMPLETED'),
    createdAt: createdAt(),
  },
  (t) => [index('donations_group_idx').on(t.groupId, t.createdAt)],
);

/** PayPal webhook events; the PK (PayPal event id) is the dedupe key. Raw JSON kept for audit/replay. */
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  resourceId: text('resource_id'),
  verified: boolean('verified').notNull(),
  raw: jsonb('raw').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  processedAt: ts('processed_at'),
});

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull().references(() => requests.id),
    channel: text('channel').notNull(),
    lang: text('lang').notNull(),
    messageKey: text('message_key').notNull(),
    text: text('text').notNull(),
    status: text('status').$type<'queued' | 'sent' | 'failed'>().notNull().default('queued'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('notifications_request_idx').on(t.requestId)],
);

/** Append-only, hash-chained audit log. UPDATE/DELETE are rejected by a trigger (see migrations). */
export const auditLog = pgTable('audit_log', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  at: ts('at').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  prevHash: text('prev_hash').notNull(),
  rowHash: text('row_hash').notNull().unique(),
});

export const schema = {
  groups,
  organizers,
  policies,
  requests,
  approvals,
  approvalSignatures,
  payoutBatches,
  payoutItems,
  donations,
  webhookEvents,
  notifications,
  auditLog,
};
