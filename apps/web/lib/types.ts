/**
 * View models returned by the services facade (lib/server/services.ts) and the HTTP API.
 * Domain shapes come from @neighborline/core; these only add what screens need on top.
 * Money is integer cents everywhere.
 */
import type {
  Channel,
  HelpRequest,
  IntakeExtraction,
  Lang,
  PayoutBatch,
  PayoutItem,
  PayoutItemStatus,
  RequestStatus,
  StageEvent,
} from '@neighborline/core';

export type ScenarioId = 'lan' | 'rosa' | 'jean' | 'walter' | 'blocked';
export type PlayMode = 'auto' | 'manual';

export interface Organizer {
  id: string;
  name: string;
  handle: string;
  deviceLabel: string;
}

export interface FiscalSponsorCheck {
  key: 'business_account' | 'charity_confirmed' | 'payouts_enabled' | 'purpose_donations' | 'webhooks_verified';
  label: string;
  ok: boolean;
  /** true when the check is satisfied by a simulation (fake PayPal / sandbox), not a live account */
  simulated: boolean;
  detail: string;
}

export interface PolicyCategoryView {
  key: string;
  label: string;
  maxCents: number;
  perHouseholdPer30dCents: number;
}

export interface GroupView {
  id: string;
  slug: string;
  name: string;
  payoutHandle: string;
  fiscalSponsor: { name: string; checks: FiscalSponsorCheck[] };
  organizers: Organizer[];
  policy: {
    id: string;
    version: number;
    categories: PolicyCategoryView[];
    householdCapPer30dCents: number;
    dailyBudgetCents: number;
    approvalsRequired: number;
  };
}

/** How code (never the AI) arrived at the amount. Shown under "Why this amount?". */
export interface AmountBreakdown {
  requestedCents: number | null;
  categoryMaxCents: number;
  householdRemainingCents: number;
  dailyRemainingCents: number;
  resultCents: number;
  /** which limit produced the result */
  limitedBy: 'requested' | 'category' | 'household' | 'daily';
}

export type SignerKind = 'passkey' | 'demo_key';

export interface ApprovalMark {
  organizerId: string;
  name: string;
  at: string;
  /** How this approval was signed: a passkey on the organizer's device, or the labelled demo key. Absent = unsigned (old history). */
  signer?: { kind: SignerKind; deviceLabel: string };
}

/** The WebAuthn assertion a browser returns (@simplewebauthn/browser AuthenticationResponseJSON). */
export interface PasskeyAssertionJSON {
  id: string;
  rawId: string;
  type: 'public-key';
  response: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle?: string };
  clientExtensionResults?: Record<string, unknown>;
  authenticatorAttachment?: string;
}

/**
 * One organizer's Approve tap. Every tap is signed over the approval hash: with the organizer's
 * passkey, or — only when DEMO_MODE is on — with that organizer's server-held demo key.
 */
export type ApproveInput =
  | { requestIds: string[]; signer: { kind: 'passkey'; assertion: PasskeyAssertionJSON }; organizerId?: string }
  | { requestIds: string[]; signer: { kind: 'demo_key' }; organizerId: string };

export interface ApprovalChallenge {
  approvalHash: string;
  /** PublicKeyCredentialRequestOptionsJSON for @simplewebauthn/browser startAuthentication */
  optionsJSON: Record<string, unknown> & { challenge: string };
}

export interface OrganizerSession {
  organizerId: string;
  name: string;
  credentialId: string;
  deviceLabel: string;
  kind: SignerKind;
}

/** Who has enrolled what (no keys), for the /organizer onboarding screen. */
export interface PasskeyRoster {
  demoMode: boolean;
  inviteRequired: boolean;
  organizers: Array<{ id: string; name: string; passkeys: Array<{ deviceLabel: string; createdAt: string }> }>;
}

export interface RequestView {
  request: HelpRequest;
  /** first name + neighborhood only — organizers never see full names */
  requester: { displayName: string; area?: string };
  categoryLabel: string;
  audioSeconds?: number;
  approvals: ApprovalMark[];
  approvalsRequired: number;
  amountBreakdown: AmountBreakdown | null;
  payout: { batch: PayoutBatch; item: PayoutItem } | null;
  decline?: { organizerId: string; reasonCode: DeclineReasonCode; note?: string; at: string };
  /** One-line summary of the schema pipeline behind the AI extraction (agents' trace.summary). */
  aiTrace?: { status: 'valid' | 'locally_fixed' | 'repaired' | 'invalid' | 'error'; summary: string };
}

export type ThreadMessageKind =
  | 'voice'
  | 'text'
  | 'photo'
  | 'readback'
  | 'ack'
  | 'status'
  | 'paid'
  | 'claim_help'
  | 'declined'
  | 'blocked';

export interface ThreadMessage {
  id: string;
  at: string;
  from: 'neighbor' | 'line';
  kind: ThreadMessageKind;
  lang: Lang;
  text: string;
  /** English rendering for organizers / judges ("Translated" toggle) */
  textEn?: string;
  meta?: {
    audioSeconds?: number;
    amountCents?: number;
    transactionId?: string;
    wallet?: 'PAYPAL' | 'VENMO';
    receiver?: string;
    channel?: Channel;
  };
}

export interface ThreadView {
  requestId: string;
  lang: Lang;
  status: RequestStatus;
  itemStatus: PayoutItemStatus | null;
  awaitingConfirmation: boolean;
  messages: ThreadMessage[];
  approvalsCount: number;
  approvalsRequired: number;
}

export interface IntakeResult {
  requestId: string;
  status: RequestStatus;
  transcript: { text: string; lang: Lang; textEn: string };
  readBack: { text: string; lang: Lang; textEn: string; audioUrl?: string };
  extraction: IntakeExtraction;
  missing: IntakeExtraction['missing'];
  /** true when no real speech-to-text ran (fixture mode) and a sample transcript was used */
  simulatedTranscript: boolean;
}

export interface SampleVoiceNote {
  id: ScenarioId;
  lang: Lang;
  languageName: string;
  speaker: string;
  seconds: number;
  gist: string;
}

export type DeclineReasonCode = 'outside_area' | 'household_cap' | 'needs_info' | 'not_covered' | 'other';

export interface ApprovalResult {
  approvalId: string;
  /** what this tap was signed with */
  signer?: { organizerId: string; kind: SignerKind; deviceLabel: string };
  count: number;
  required: number;
  executed: boolean;
  batchId?: string;
  senderBatchId?: string;
}

/** Messages on GET /api/stream. `requestIds` scopes each event so many visitors can share one server. */
export type StreamMessage =
  | { kind: 'hello'; serverTime: string }
  | { kind: 'stage'; event: StageEvent; requestIds: string[] };

export interface ScenarioRun {
  requestId: string;
  scenario: ScenarioId;
  mode: PlayMode;
  speed: number;
  manualOrganizerId: string | null;
}

/* ---------- report ---------- */

export type NarrativeSegment = string | { figure: string; ref: string };

export interface ReportView {
  generatedAt: string;
  period: { from: string; to: string; label: string };
  narrative: {
    paragraphs: NarrativeSegment[][];
    writtenBy: string;
    figuresChecked: number;
    allFiguresMatchLedger: boolean;
  };
  totals: {
    paidCents: number;
    households: number;
    payouts: number;
    medianSecondsToCash: number;
    p90SecondsToCash: number;
    languages: number;
    unclaimedTotal: number;
    unclaimedRescued: number;
    /** true when fewer than k people were ever unclaimed, so the counts are withheld (k-anonymity) */
    unclaimedMasked?: boolean;
    donationsCents: number;
    donors: number;
  };
  timeToCash: Array<{ label: string; fromSec: number; toSec: number | null; count: number }>;
  byLanguage: Array<{ key: string; label: string; households: number; paidCents: number }>;
  byCategory: Array<{ key: string; label: string; payouts: number; paidCents: number }>;
  approvalParity: Array<{ key: string; label: string; n: number; medianMinutesToApproval: number; approvalRate: number }>;
  kAnonymity: { k: number; note: string };
  lines: Array<{ date: string; categoryLabel: string; amountCents: number; transactionId: string; status: PayoutItemStatus }>;
}

/* ---------- ledger ---------- */

/** 'seeded' = demo history created by the seed script; it never went through this PayPal environment. */
export type ReconcileState = 'matched' | 'pending' | 'mismatch' | 'seeded';

export interface LedgerRow {
  itemId: string;
  batchId: string;
  senderBatchId: string;
  paypalBatchId?: string;
  requestRef: string;
  createdAt: string;
  categoryLabel: string;
  lang: Lang;
  wallet: 'PAYPAL' | 'VENMO';
  receiverMasked: string;
  amountCents: number;
  status: PayoutItemStatus;
  transactionId?: string;
  reconcile: ReconcileState;
}

export interface LedgerView {
  rows: LedgerRow[];
  summary: { paidCents: number; pendingCents: number; unclaimedCents: number; items: number; batches: number };
  lastReconciledAt: string | null;
  balanceCents: number;
}

export interface ReconcileResult {
  checked: number;
  matched: number;
  mismatched: number;
  at: string;
  simulated: boolean;
}

/* ---------- donations ---------- */

export type DonationSource = 'PAYPAL' | 'VENMO' | 'PAYLATER' | 'CARD' | 'SUBSCRIPTION';

export interface DonationOrder {
  orderId: string;
  amountCents: number;
  simulated: boolean;
}

export interface DonationCapture {
  orderId: string;
  status: 'COMPLETED' | 'DECLINED';
  captureId: string;
  amountCents: number;
  simulated: boolean;
}

export interface SubscriptionPlan {
  planId: string | null;
  amountCents: number;
  simulated: boolean;
}

export interface RuntimeModes {
  paypalMode: 'fake' | 'sandbox' | 'mock';
  aiMode: 'fixture' | 'live';
  engine: 'mock' | 'real';
}

export interface TrustView {
  group: GroupView;
  modes: RuntimeModes;
  sandboxReality: Array<{ label: string; status: 'real' | 'simulated' | 'not_yet'; detail: string }>;
}
