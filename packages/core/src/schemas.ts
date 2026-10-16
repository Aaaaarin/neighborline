/**
 * Shared domain contract for Neighborline. Every lane imports from here.
 * Money is integer cents. Times are ISO-8601 strings.
 */
import { z } from 'zod';

export const LANGS = ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'] as const;
export const Lang = z.enum(LANGS);
export type Lang = z.infer<typeof Lang>;

export const Wallet = z.enum(['PAYPAL', 'VENMO']);
export type Wallet = z.infer<typeof Wallet>;
export const RecipientType = z.enum(['EMAIL', 'USER_HANDLE', 'PHONE']);
export type RecipientType = z.infer<typeof RecipientType>;

export const PayoutDestination = z.object({
  wallet: Wallet,
  type: RecipientType,
  value: z.string().min(1).max(127),
  nameOnFile: z.string().max(120).optional(),
});
export type PayoutDestination = z.infer<typeof PayoutDestination>;

export const Channel = z.enum(['web_voice', 'web_text', 'whatsapp', 'phone', 'sms']);
export type Channel = z.infer<typeof Channel>;

/** AI output of the intake agent. Validated before use; never trusted for amounts. */
export const IntakeExtraction = z.object({
  lang: Lang,
  summaryEn: z.string().min(1).max(600),
  summaryNative: z.string().min(1).max(600),
  category: z.string().min(1).max(64), // a policy category key or 'other'
  householdSize: z.number().int().min(1).max(30).optional(),
  urgency: z.enum(['today', 'this_week', 'later']),
  requestedItems: z.array(z.string().max(80)).max(12),
  requestedAmountCents: z.number().int().min(0).max(1_000_000).optional(),
  payout: PayoutDestination.omit({ nameOnFile: true }).optional(),
  missing: z.array(z.enum(['payout', 'category', 'household', 'location'])),
  confidence: z.number().min(0).max(1),
});
export type IntakeExtraction = z.infer<typeof IntakeExtraction>;

export const PolicyCategory = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  label: z.record(z.string()), // Lang -> label; must include 'en'
  maxCents: z.number().int().positive(),
  perHouseholdPer30dCents: z.number().int().positive(),
  requiresPhoto: z.boolean().optional(),
});
export type PolicyCategory = z.infer<typeof PolicyCategory>;

/** Compiled, versioned, immutable policy. Activated only with two organizer approvals. */
export const Policy = z.object({
  id: z.string(),
  groupId: z.string(),
  version: z.number().int().positive(),
  sourceText: z.string(),
  currency: z.literal('USD'),
  categories: z.array(PolicyCategory).min(1),
  householdCapPer30dCents: z.number().int().positive(),
  dailyBudgetCents: z.number().int().positive(),
  maxRequestsPerDestinationPer30d: z.number().int().positive(),
  createdAt: z.string(),
  approvedBy: z.array(z.string()),
});
export type Policy = z.infer<typeof Policy>;

export const RailFlagCode = z.enum([
  'LOOKALIKE_HANDLE',
  'DUP_DESTINATION_DIFF_NAME',
  'VELOCITY',
  'CAP_EXCEEDED',
  'BUDGET_EXCEEDED',
  'PROMPT_INJECTION',
  'DEST_IS_GROUP_HANDLE',
]);
export type RailFlagCode = z.infer<typeof RailFlagCode>;
export const RailFlag = z.object({
  code: RailFlagCode,
  severity: z.enum(['block', 'review']),
  detail: z.string(),
});
export type RailFlag = z.infer<typeof RailFlag>;

export const RequestStatus = z.enum([
  'intake',
  'needs_clarification',
  'awaiting_approval',
  'approved',
  'paying',
  'paid',
  'unclaimed',
  'returned',
  'failed',
  'declined',
  'cancelled',
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const ComputedAmount = z.object({
  amountCents: z.number().int().nonnegative(),
  ruleKey: z.string(),
  ruleCitation: z.string(), // human-readable, e.g. "Policy v3 · Utility outage · max $150 per request"
  policyVersion: z.number().int(),
});
export type ComputedAmount = z.infer<typeof ComputedAmount>;

export const HelpRequest = z.object({
  id: z.string(),
  groupId: z.string(),
  createdAt: z.string(),
  channel: Channel,
  lang: Lang,
  originalText: z.string(),
  englishText: z.string(),
  audioRef: z.string().optional(),
  photoRefs: z.array(z.string()),
  extracted: IntakeExtraction.nullable(),
  confirmedByRequester: z.boolean(),
  payoutDestination: PayoutDestination.nullable(),
  status: RequestStatus,
  policyVersionId: z.string().nullable(),
  computed: ComputedAmount.nullable(),
  railFlags: z.array(RailFlag),
  contact: z.object({ phone: z.string().optional(), whatsapp: z.string().optional() }).optional(),
});
export type HelpRequest = z.infer<typeof HelpRequest>;

export const Approver = z.object({
  organizerId: z.string(),
  at: z.string(),
  deviceLabel: z.string(),
});
export type Approver = z.infer<typeof Approver>;

export const Approval = z.object({
  id: z.string(),
  requestIds: z.array(z.string()).min(1),
  approvers: z.array(Approver),
  totalCents: z.number().int().nonnegative(),
  policyVersionId: z.string(),
  hash: z.string(), // sha256 of canonical JSON of {requestIds(sorted), amounts, destinations, policyVersionId}
  status: z.enum(['pending', 'complete', 'executed', 'void']),
});
export type Approval = z.infer<typeof Approval>;

export const PayoutItemStatus = z.enum([
  'PENDING',
  'SUCCESS',
  'UNCLAIMED',
  'RETURNED',
  'ONHOLD',
  'BLOCKED',
  'FAILED',
  'REFUNDED',
  'REVERSED',
  'CANCELED',
]);
export type PayoutItemStatus = z.infer<typeof PayoutItemStatus>;

export const PayoutItem = z.object({
  id: z.string(),
  batchId: z.string(),
  requestId: z.string(),
  senderItemId: z.string(),
  paypalItemId: z.string().optional(),
  amountCents: z.number().int().positive(),
  wallet: Wallet,
  receiver: z.string(),
  recipientType: RecipientType,
  status: PayoutItemStatus,
  transactionId: z.string().optional(),
  lastEventAt: z.string(),
});
export type PayoutItem = z.infer<typeof PayoutItem>;

export const PayoutBatch = z.object({
  id: z.string(),
  approvalId: z.string(),
  senderBatchId: z.string(), // 'nl_' + approval.hash.slice(0, 24)
  paypalBatchId: z.string().optional(),
  status: z.enum(['CREATING', 'PENDING', 'PROCESSING', 'SUCCESS', 'DENIED', 'CANCELED', 'FAILED']),
  createdAt: z.string(),
});
export type PayoutBatch = z.infer<typeof PayoutBatch>;

/** Events broadcast to the /demo stage and organizer phones (SSE). */
export const StageEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request.created'), at: z.string(), requestId: z.string(), lang: Lang, channel: Channel }),
  z.object({ type: z.literal('request.transcribed'), at: z.string(), requestId: z.string(), text: z.string(), lang: Lang }),
  z.object({ type: z.literal('request.readback'), at: z.string(), requestId: z.string(), text: z.string(), lang: Lang }),
  z.object({ type: z.literal('request.confirmed'), at: z.string(), requestId: z.string() }),
  z.object({ type: z.literal('request.flagged'), at: z.string(), requestId: z.string(), flags: z.array(RailFlag) }),
  z.object({ type: z.literal('approval.added'), at: z.string(), approvalId: z.string(), organizerId: z.string(), count: z.number() }),
  z.object({ type: z.literal('payout.batch_created'), at: z.string(), batchId: z.string(), senderBatchId: z.string(), paypalBatchId: z.string().optional(), itemCount: z.number(), totalCents: z.number() }),
  z.object({ type: z.literal('payout.item_updated'), at: z.string(), itemId: z.string(), requestId: z.string(), status: PayoutItemStatus, paypalItemId: z.string().optional(), transactionId: z.string().optional() }),
  z.object({ type: z.literal('webhook.verified'), at: z.string(), eventType: z.string(), eventId: z.string() }),
  z.object({ type: z.literal('notify.sent'), at: z.string(), requestId: z.string(), lang: Lang, text: z.string(), channel: Channel }),
  z.object({ type: z.literal('donation.captured'), at: z.string(), amountCents: z.number(), source: z.enum(['PAYPAL', 'VENMO', 'PAYLATER', 'CARD', 'SUBSCRIPTION']) }),
]);
export type StageEvent = z.infer<typeof StageEvent>;
