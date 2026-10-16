/**
 * The ONE seam between the web app and the domain packages.
 *
 * Route handlers under app/api/** are thin adapters over this interface, and server components
 * call it directly. It is backed by the real engine (lib/server/engine/engine.ts: @neighborline/core,
 * /db, /paypal, /agents); ENGINE=mock switches back to the in-memory mock (lib/server/mock-engine.ts)
 * as a fallback. See apps/web/INTEGRATION.md.
 */
import 'server-only';
import type { PayoutActor } from './security/viewer';
import type { Channel, HelpRequest, Lang, RequestStatus } from '@neighborline/core';
import type {
  ApprovalChallenge,
  ApprovalResult,
  ApproveInput,
  CompilePolicyOutcome,
  OrganizerSession,
  PolicyEditorView,
  PolicySignInput,
  PolicySignResult,
  PasskeyAssertionJSON,
  PasskeyRoster,
  DeclineReasonCode,
  DonationCapture,
  DonationOrder,
  DonationSource,
  GroupView,
  IntakeResult,
  LedgerView,
  ManualPayoutResult,
  PlayMode,
  RailSettingsView,
  ReconcileResult,
  ReportView,
  RequestView,
  RuntimeModes,
  SampleVoiceNote,
  ScenarioId,
  ScenarioRun,
  StreamMessage,
  SubscriptionPlan,
  ThreadView,
  TrustView,
} from '../types';
import type {
  OrganizerAlertRequest,
  OrganizerAlertResponse,
  ReconcileRequest,
  ReconcileResponse,
  RenotifyRequest,
  RenotifyResponse,
  ReportRefreshRequest,
  ReportRefreshResponse,
  UnclaimedSweepRequest,
  UnclaimedSweepResponse,
} from './internal-contract';
import type { SpeedSplit } from '../../components/stage/stage-steps';
import { Engine } from './engine/engine';
import type { PhoneIntake } from './voice/bridge';
import { MockEngine } from './mock-engine';

export interface AudioInput {
  /** raw recording from MediaRecorder (webm/ogg/mp4); absent when a sample is used */
  audio?: Blob;
  /** id of a bundled sample voice note (judges without a mic) */
  sampleId?: ScenarioId;
  /** language picked by the neighbor; undefined = auto-detect */
  lang?: Lang;
  photo?: Blob;
}

/** Background jobs behind POST /api/internal/* (contract: lib/server/internal-contract.ts = workflows/src/contract.ts). */
export interface InternalOps {
  reconcileWindow(req: ReconcileRequest): Promise<ReconcileResponse>;
  unclaimedSweep(req: UnclaimedSweepRequest): Promise<UnclaimedSweepResponse>;
  renotify(req: RenotifyRequest): Promise<RenotifyResponse>;
  organizerAlert(req: OrganizerAlertRequest): Promise<OrganizerAlertResponse>;
  reportRefresh(req: ReportRefreshRequest): Promise<ReportRefreshResponse>;
}

export interface Services {
  readonly modes: RuntimeModes;
  /** Present on the real engine only (the mock answers 501). */
  readonly internal?: InternalOps;
  /** Present on the real engine only: is the approver process reachable? */
  approverUp?(): Promise<boolean>;
  /** Present on the real engine only: the phone line's intake entry point (lib/server/voice, channel 'phone'). */
  phone?(): Promise<PhoneIntake>;

  /* intake (neighbor) */
  /** `id`: the route mints `req_v_<visitorTag>_…` so the visitor who started it owns it (security/visitor.ts). */
  startIntake(input: { groupSlug: string; channel: Channel; lang?: Lang; id?: string }): Promise<{ requestId: string }>;
  submitAudio(requestId: string, input: AudioInput): Promise<IntakeResult>;
  submitText(requestId: string, input: { text: string; lang?: Lang }): Promise<IntakeResult>;
  confirmIntake(
    requestId: string,
    input: { confirmed: boolean; corrections?: string },
  ): Promise<{ status: RequestStatus; thread: ThreadView }>;
  getThread(requestId: string): Promise<ThreadView | null>;
  listSampleVoiceNotes(): SampleVoiceNote[];

  /* organizers */
  getGroup(): Promise<GroupView>;
  listRequests(filter?: { status?: RequestStatus[] }): Promise<RequestView[]>;
  getRequest(requestId: string): Promise<RequestView | null>;
  /**
   * One signed Approve tap: the WebAuthn assertion (or, in DEMO_MODE, the labelled demo key) is
   * verified over the current approval hash and stored before the approver is recorded.
   * `origin` = the browser's Origin header (route handlers pass it; server-side callers omit it).
   */
  approve(input: ApproveInput & { origin?: string | null }): Promise<ApprovalResult>;

  /* organizer passkeys (WebAuthn) */
  passkeyRoster(): Promise<PasskeyRoster>;
  passkeyRegistrationOptions(input: { organizerId: string; origin: string | null; inviteCode?: string; session: OrganizerSession | null; demoVisitorTag?: string }): Promise<{ optionsJSON: unknown }>;
  passkeyRegister(input: { organizerId: string; origin: string | null; response: unknown; deviceLabel: string; inviteCode?: string; session: OrganizerSession | null; demoVisitorTag?: string }): Promise<OrganizerSession>;
  passkeySignInOptions(input: { origin: string | null }): Promise<{ optionsJSON: unknown }>;
  passkeySignIn(input: { response: PasskeyAssertionJSON }): Promise<OrganizerSession>;
  approvalChallenge(input: { requestIds: string[]; origin: string | null; organizerId?: string; credentialIds?: string[] }): Promise<ApprovalChallenge>;
  /** The session if its passkey still exists (null once that device is revoked). */
  liveSession(session: OrganizerSession | null): Promise<OrganizerSession | null>;
  /** Revoke an organizer's passkey; needs a live session of an organizer of the group. */
  revokePasskey(input: { credentialId: string; session: OrganizerSession | null }): Promise<{ organizerId: string; deviceLabel: string; signedOut: boolean }>;

  /* rules editor: AI drafts the policy, two organizers sign to activate it */
  policyEditor(): Promise<PolicyEditorView>;
  compilePolicy(input: { sourceText: string; session: OrganizerSession | null }): Promise<CompilePolicyOutcome>;
  policyChallenge(input: { draftHash: string; origin: string | null; organizerId?: string }): Promise<ApprovalChallenge>;
  signPolicy(input: PolicySignInput & { origin?: string | null }): Promise<PolicySignResult>;

  decline(input: {
    requestId: string;
    organizerId: string;
    reasonCode: DeclineReasonCode;
    note?: string;
  }): Promise<{ status: RequestStatus; message: { text: string; textEn: string; lang: Lang }; alreadyDeclined?: boolean }>;
  previewDecline(input: { requestId: string; reasonCode: DeclineReasonCode; note?: string }): Promise<{
    text: string;
    textEn: string;
    lang: Lang;
  }>;
  /** `actor`: a signed-in organizer, or a DEMO_MODE visitor who may cancel only their own demo run's item. */
  cancelPayoutItem(input: { batchId: string; itemId: string; actor: PayoutActor }): Promise<{ status: string }>;

  /* payout rails (apps/approver/src/rails.ts): PayPal Payouts, and a manual fallback that records only */
  railSettings(): Promise<RailSettingsView>;
  /** "If PayPal is unavailable or the account is restricted, switch to manual recording". Needs a live organizer session. */
  setManualFallback(input: { enabled: boolean; session: OrganizerSession | null }): Promise<RailSettingsView>;
  /** Record a cash/check hand-over for a batch PayPal refused at the account level. Needs a live organizer session. */
  recordManualPayout(input: { batchId: string; method: 'cash' | 'check' | 'other'; receiptNote: string; session: OrganizerSession | null }): Promise<ManualPayoutResult>;

  /* PayPal */
  handlePaypalWebhook(input: { headers: Record<string, string>; rawBody: string }): Promise<{ verified: boolean; eventType: string }>;
  reconcile(): Promise<ReconcileResult>;
  getLedger(): Promise<LedgerView>;

  /* donors */
  createDonationOrder(input: { amountCents: number; source: DonationSource }): Promise<DonationOrder>;
  captureDonationOrder(orderId: string): Promise<DonationCapture>;
  getSubscriptionPlan(input: { amountCents: number }): Promise<SubscriptionPlan>;
  recordSubscription(input: { subscriptionId: string; amountCents: number }): Promise<{ ok: boolean; simulated: boolean }>;

  /* transparency */
  getReport(): Promise<ReportView>;
  getTrust(): Promise<TrustView>;

  /* live events (SSE) — returns unsubscribe */
  subscribe(listener: (msg: StreamMessage) => void): () => void;
  /** past messages touching a request, for reconnects and page reloads */
  replay(requestId: string): StreamMessage[];

  /** People vs system time of the most recent paid run on this server (null = none yet). */
  lastRunSpeed(): SpeedSplit | null;

  /* demo stage only (DEMO_MODE=true) */
  /** `visitorTag`: the run's id becomes `req_demo_<tag>_…`, visible in full only to that visitor. */
  playScenario(input: { scenario: ScenarioId; mode: PlayMode; speed?: number; visitorTag?: string }): Promise<ScenarioRun>;
  resetDemo(): Promise<void>;
}

export type { HelpRequest };

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineServices: Services | undefined;
}

function createServices(): Services {
  if (process.env.ENGINE === 'mock') return new MockEngine();
  // `next build` can evaluate server code while collecting page data. Never let a build process
  // touch (or half-seed) the real database: give it a throwaway in-memory one.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return new Engine({ env: { ...process.env, DATABASE_URL: '', DEV_DB_CONTROL_URL: '', PGLITE_DIR: '' } });
  }
  return new Engine();
}

/** Process-wide singleton (globalThis survives Next dev hot reloads and is shared across route bundles). */
export function services(): Services {
  if (!globalThis.__neighborlineServices) globalThis.__neighborlineServices = createServices();
  return globalThis.__neighborlineServices;
}
