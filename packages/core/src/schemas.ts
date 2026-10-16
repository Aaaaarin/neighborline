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
  /** Which limit produced the final amount (additive, optional). */
  limitedBy: z
    .enum(['requested', 'category_max', 'household_cap', 'category_household_cap', 'daily_budget'])
    .optional(),
});
export type ComputedAmount = z.infer<typeof ComputedAmount>;

/**
 * A prior request as seen by the amount + rail checks (additive). `amountCents` is what was
 * committed/paid; `status` decides whether it still counts against caps.
 */
export const HistoryEntry = z.object({
  requestId: z.string(),
  createdAt: z.string(),
  ruleKey: z.string(),
  amountCents: z.number().int().nonnegative(),
  status: RequestStatus,
  destination: PayoutDestination,
  phone: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

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

const B64URL = z.string().regex(/^[A-Za-z0-9_-]*$/, 'base64url');

/**
 * An approver's WebAuthn assertion over the approval hash (challenge = base64url of the hash's 32
 * bytes). Carries everything needed to re-verify the signature later against the credential's
 * stored public key; see NOTES-passkeys.md and @neighborline/passkeys.
 */
export const ApproverAssertion = z.object({
  v: z.literal(1),
  /** 'passkey' = an authenticator the organizer holds; 'demo_key' = server-held software key (DEMO_MODE only) */
  kind: z.enum(['passkey', 'demo_key']),
  credentialId: B64URL.min(1),
  authenticatorData: B64URL.min(37),
  clientDataJSON: B64URL.min(1),
  signature: B64URL.min(1),
  userHandle: B64URL.optional(),
  rpId: z.string().min(1),
  origin: z.string().min(1),
  approvalHash: z.string().regex(/^[0-9a-f]{64}$/),
  deviceLabel: z.string().min(1).max(80),
  verifiedAt: z.string(),
});
export type ApproverAssertion = z.infer<typeof ApproverAssertion>;

export const Approver = z.object({
  organizerId: z.string(),
  at: z.string(),
  deviceLabel: z.string(),
  /** Present when the approval was signed (passkey or labelled demo key). */
  assertion: ApproverAssertion.optional(),
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

// ---------- Persistence-facing entities (additive; owned by core+db lane) ----------

/** An official identity of the group on a payment rail (used by rail protection). */
export const OfficialHandle = z.object({ wallet: Wallet, type: RecipientType, value: z.string().min(1) });
export type OfficialHandle = z.infer<typeof OfficialHandle>;

export const FiscalSponsor = z.object({
  name: z.string(),
  paypalBusinessVerified: z.boolean(),
  payoutsEnabled: z.boolean(),
  charityConfirmed: z.boolean(),
});
export type FiscalSponsor = z.infer<typeof FiscalSponsor>;

export const Group = z.object({
  id: z.string(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1),
  officialHandles: z.array(OfficialHandle),
  fiscalSponsor: FiscalSponsor,
  activePolicyId: z.string().nullable(),
  /** IANA zone used for the daily budget boundary. */
  timezone: z.string(),
  /** Distinct organizers required per payout; never below 2. */
  requiredApprovals: z.number().int().min(2),
  createdAt: z.string(),
});
export type Group = z.infer<typeof Group>;

export const Organizer = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string().min(1),
  /** The organizer's own emails / Venmo handles / phones — used to block self-payment and lookalikes. */
  handles: z.array(z.string()),
  lang: Lang,
  createdAt: z.string(),
});
export type Organizer = z.infer<typeof Organizer>;

export const DonationSource = z.enum(['PAYPAL', 'VENMO', 'PAYLATER', 'CARD', 'SUBSCRIPTION']);
export type DonationSource = z.infer<typeof DonationSource>;

export const Donation = z.object({
  id: z.string(),
  groupId: z.string(),
  amountCents: z.number().int().positive(),
  source: DonationSource,
  /** Opaque, non-PII donor key (e.g. hash of payer id) for distinct-donor counts. */
  donorKey: z.string().nullable(),
  paypalOrderId: z.string().nullable(),
  paypalSubscriptionId: z.string().nullable(),
  transactionId: z.string().nullable(),
  status: z.enum(['CREATED', 'COMPLETED', 'REFUNDED']),
  createdAt: z.string(),
});
export type Donation = z.infer<typeof Donation>;
