/**
 * The ONE seam between the web app and the domain packages.
 *
 * Route handlers under app/api/** are thin adapters over this interface, and server components
 * call it directly. Today it is backed by the in-memory mock engine (lib/server/mock-engine.ts).
 * The integrator swaps in an implementation built on @neighborline/core, /db, /paypal and /agents
 * by changing `createServices()` below — no page or route needs to change. See apps/web/INTEGRATION.md.
 */
import 'server-only';
import type { Channel, HelpRequest, Lang, RequestStatus } from '@neighborline/core';
import type {
  ApprovalResult,
  DeclineReasonCode,
  DonationCapture,
  DonationOrder,
  DonationSource,
  GroupView,
  IntakeResult,
  LedgerView,
  PlayMode,
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

export interface Services {
  readonly modes: RuntimeModes;

  /* intake (neighbor) */
  startIntake(input: { groupSlug: string; channel: Channel; lang?: Lang }): Promise<{ requestId: string }>;
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
  approve(input: { requestIds: string[]; organizerId: string; deviceLabel: string }): Promise<ApprovalResult>;
  decline(input: {
    requestId: string;
    organizerId: string;
    reasonCode: DeclineReasonCode;
    note?: string;
  }): Promise<{ status: RequestStatus; message: { text: string; textEn: string; lang: Lang } }>;
  previewDecline(input: { requestId: string; reasonCode: DeclineReasonCode; note?: string }): Promise<{
    text: string;
    textEn: string;
    lang: Lang;
  }>;
  cancelPayoutItem(input: { batchId: string; itemId: string }): Promise<{ status: string }>;

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

  /* demo stage only (DEMO_MODE=true) */
  playScenario(input: { scenario: ScenarioId; mode: PlayMode; speed?: number }): Promise<ScenarioRun>;
  resetDemo(): Promise<void>;
}

export type { HelpRequest };

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineServices: Services | undefined;
}

function createServices(): Services {
  // Integrator: return `createRealServices()` here when PAYPAL_MODE/AI_MODE and DATABASE_URL are wired.
  return new MockEngine();
}

/** Process-wide singleton (globalThis survives Next dev hot reloads and is shared across route bundles). */
export function services(): Services {
  if (!globalThis.__neighborlineServices) globalThis.__neighborlineServices = createServices();
  return globalThis.__neighborlineServices;
}
