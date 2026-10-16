/**
 * Endpoint contract between Render Workflows and apps/web.
 * The web integrator implements these routes; docs/DEPLOY.md §"Endpoint contract" mirrors this file.
 *
 * All /api/internal/* routes:
 *   - POST, JSON body, HMAC-signed (see signing.ts); 401 on a bad/missing/stale signature.
 *   - Node runtime, `dynamic = 'force-dynamic'`, never cached.
 *   - Idempotent: the workflow retries on network errors, 408, 425, 429 and 5xx, so the same request
 *     can arrive more than once. Use the `idempotencyKey` where given.
 *   - 4xx other than those = permanent failure (the task run fails and shows up red in the Render dashboard).
 * Money stays integer cents. Timestamps are ISO-8601 UTC strings.
 */

export type ItemStatus =
  | 'PENDING' | 'SUCCESS' | 'UNCLAIMED' | 'RETURNED' | 'ONHOLD' | 'BLOCKED'
  | 'FAILED' | 'REFUNDED' | 'REVERSED' | 'CANCELED';

/** GET /api/health — public, unauthenticated, fast, no PayPal/LLM calls. Render's health check + keep-warm. */
export interface HealthResponse {
  ok: true;
  /** e.g. RENDER_GIT_COMMIT */
  version?: string;
  paypalMode?: 'fake' | 'sandbox' | 'live';
  aiMode?: 'fixture' | 'live';
  db?: 'postgres' | 'pglite';
}

/** POST /api/internal/reconcile — compare local payout items with PayPal Transaction Search for one window. */
export interface ReconcileRequest {
  /** Inclusive window start. The app pages Transaction Search (<= 31 days per call, page_size <= 500). */
  startDate: string;
  /** Exclusive window end. May be "now": items newer than now - lagHours are reported as pendingLag, not mismatches. */
  endDate: string;
  lagHours: number;
  /** Stable per window; lets the app dedupe the stored reconcile record. */
  idempotencyKey: string;
}
export type MismatchKind = 'missing_at_paypal' | 'unknown_at_paypal' | 'status_mismatch' | 'amount_mismatch';
export interface ReconcileMismatch {
  itemId: string;
  kind: MismatchKind;
  senderItemId?: string;
  paypalItemId?: string;
  transactionId?: string;
  local?: { status: ItemStatus; amountCents: number };
  paypal?: { status: string; amountCents: number };
}
export interface ReconcileResponse {
  window: { startDate: string; endDate: string };
  checked: number;
  matched: number;
  mismatches: ReconcileMismatch[];
  /** Local items too recent to be visible in Transaction Search yet. */
  pendingLag: Array<{ itemId: string; paidAt: string }>;
  fetchedTransactions: number;
}

/** POST /api/internal/unclaimed-sweep — READ-ONLY list of payout items currently UNCLAIMED. Decisions are made in the workflow. */
export interface UnclaimedSweepRequest {
  now: string;
  /** Only return items unclaimed at least this long. */
  minAgeHours: number;
}
export interface UnclaimedItem {
  itemId: string;
  requestId: string;
  /** Requester's language (BCP-47 primary subtag); renotify must use it. */
  lang: string;
  wallet: 'PAYPAL' | 'VENMO';
  amountCents: number;
  /** When PayPal accepted the payout item. PayPal auto-returns unclaimed items 30 days after this. */
  payoutCreatedAt: string;
  /** When the item first became UNCLAIMED (webhook time). */
  unclaimedSince: string;
  /** Follow-up messages already sent by this workflow (not counting the first UNCLAIMED notice). */
  nudgeCount: number;
  lastNudgeAt: string | null;
  organizerAlertedAt: string | null;
}
export interface UnclaimedSweepResponse {
  items: UnclaimedItem[];
}

/** POST /api/internal/unclaimed/renotify — send ONE claim-help follow-up in the requester's language. */
export interface RenotifyRequest {
  itemId: string;
  /** 1-based follow-up number (1 = the 24 h nudge). */
  nudgeNumber: number;
  /** `renotify:<itemId>:<nudgeNumber>` — the app must not send twice for the same key. */
  idempotencyKey: string;
}
export interface RenotifyResponse {
  sent: boolean;
  /** Present when sent=false. 'no_longer_unclaimed' is normal (claimed between sweep and send). */
  skippedReason?: 'no_longer_unclaimed' | 'duplicate' | 'no_contact_channel';
  lang?: string;
  channel?: string;
  notificationId?: string;
}

/** POST /api/internal/organizer-alert — tell the group's organizers something needs a human. */
export interface OrganizerAlertRequest {
  kind: 'unclaimed_day25' | 'reconcile_mismatch';
  /** Dedupe key; the app records one alert per key. */
  idempotencyKey: string;
  itemIds: string[];
  /** One-line English summary; the app may localize for organizers. */
  summary: string;
  /** For unclaimed_day25: PayPal's auto-return time (payoutCreatedAt + 30 days). */
  deadline?: string;
  detail?: unknown;
}
export interface OrganizerAlertResponse {
  alertId: string;
  /** false when the key was already recorded (still 200). */
  created: boolean;
  channels: string[];
}

/** POST /api/internal/report-refresh — regenerate the donor transparency report if N+ payouts happened since the last one. */
export interface ReportRefreshRequest {
  minNewPayouts: number;
  force: boolean;
  reason: 'schedule' | 'payout_threshold' | 'manual';
}
export interface ReportRefreshResponse {
  regenerated: boolean;
  skippedReason?: 'not_due';
  newPayoutsSinceLast: number;
  totalPayouts: number;
  reportVersion?: number;
  generatedAt?: string;
  narrativeSource?: 'llm' | 'template';
}

export const ENDPOINTS = {
  health: '/api/health',
  reconcile: '/api/internal/reconcile',
  unclaimedSweep: '/api/internal/unclaimed-sweep',
  renotify: '/api/internal/unclaimed/renotify',
  organizerAlert: '/api/internal/organizer-alert',
  reportRefresh: '/api/internal/report-refresh',
} as const;
