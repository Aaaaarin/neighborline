/**
 * Typed browser client for the SPEC §5 API (plus the documented extensions).
 * Every function maps 1:1 to a route handler under app/api/**.
 */
import type { Channel, Lang, RequestStatus } from '@neighborline/core';
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
  SampleVoiceNote,
  ScenarioId,
  ScenarioRun,
  StreamMessage,
  SubscriptionPlan,
  ThreadView,
} from './types';
import { ensureHuman, HumanCheckError } from './human-check-client';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }, retried = false): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (res.status === 403 && data.code === 'human_check_required' && !retried) {
    // Live-AI intake needs a human pass (Turnstile or a background proof of work): get one, retry once.
    try {
      await ensureHuman();
    } catch (e) {
      throw new ApiError(e instanceof HumanCheckError ? e.status : 0, e instanceof Error ? e.message : 'The browser check failed', 'human_check_failed');
    }
    return call<T>(path, init, true);
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data as T;
}

const post = <T>(path: string, json?: unknown) => call<T>(path, { method: 'POST', json: json ?? {} });

export const api = {
  /* intake */
  startIntake: (input: { groupSlug: string; channel: Channel; lang?: Lang }) => post<{ requestId: string }>('/api/intake/start', input),
  submitAudio: (requestId: string, input: { audio?: Blob; sampleId?: ScenarioId; lang?: Lang; photo?: Blob; durationSeconds?: number }) => {
    const form = new FormData();
    if (input.audio) form.set('audio', input.audio, 'voice-note');
    if (input.sampleId) form.set('sampleId', input.sampleId);
    if (input.lang) form.set('lang', input.lang);
    if (input.durationSeconds !== undefined) form.set('durationSeconds', String(Math.round(input.durationSeconds)));
    if (input.photo) form.set('photo', input.photo, 'photo');
    return call<IntakeResult>(`/api/intake/${requestId}/audio`, { method: 'POST', body: form });
  },
  submitText: (requestId: string, input: { text: string; lang?: Lang }) => post<IntakeResult>(`/api/intake/${requestId}/text`, input),
  confirm: (requestId: string, input: { confirmed: boolean; corrections?: string }) =>
    post<{ status: RequestStatus; thread: ThreadView }>(`/api/intake/${requestId}/confirm`, input),
  thread: (requestId: string) => call<ThreadView>(`/api/intake/${requestId}/thread`),
  samples: () => call<SampleVoiceNote[]>('/api/intake/samples'),

  /* organizers */
  group: () => call<GroupView>('/api/group'),
  requests: (status?: RequestStatus[]) => call<RequestView[]>(`/api/requests${status?.length ? `?status=${status.join(',')}` : ''}`),
  request: (id: string) => call<RequestView>(`/api/requests/${id}`),
  approve: (input: ApproveInput) => post<ApprovalResult>('/api/approvals', input),
  approvalChallenge: (input: { requestIds: string[]; organizerId?: string; credentialIds?: string[] }) => post<ApprovalChallenge>('/api/approvals/challenge', input),

  /* organizer passkeys */
  organizerMe: () => call<{ session: OrganizerSession | null; roster: PasskeyRoster }>('/api/organizer/me'),
  passkeyOptions: (organizerId: string, inviteCode?: string) => post<{ optionsJSON: unknown }>('/api/organizer/passkeys/options', { organizerId, ...(inviteCode ? { inviteCode } : {}) }),
  passkeyRegister: (input: { organizerId: string; deviceLabel: string; inviteCode?: string; response: unknown }) =>
    post<{ session: OrganizerSession }>('/api/organizer/passkeys', input),
  signInOptions: () => post<{ optionsJSON: unknown }>('/api/organizer/signin/options'),
  signIn: (response: PasskeyAssertionJSON) => post<{ session: OrganizerSession }>('/api/organizer/signin', { response }),
  signOut: () => post<{ ok: true }>('/api/organizer/signout'),
  revokePasskey: (credentialId: string) => post<{ organizerId: string; deviceLabel: string; signedOut: boolean }>('/api/organizer/passkeys/revoke', { credentialId }),

  /* rules editor */
  policy: () => call<PolicyEditorView>('/api/policy'),
  draftPolicy: (sourceText: string) => post<CompilePolicyOutcome>('/api/policy/draft', { sourceText }),
  policyChallenge: (input: { draftHash: string; organizerId?: string }) => post<ApprovalChallenge>('/api/policy/challenge', input),
  signPolicy: (input: PolicySignInput) => post<PolicySignResult>('/api/policy/sign', input),
  decline: (id: string, input: { organizerId: string; reasonCode: DeclineReasonCode; note?: string }) =>
    post<{ status: RequestStatus; message: { text: string; textEn: string; lang: Lang }; alreadyDeclined?: boolean }>(`/api/requests/${id}/decline`, input),
  previewDecline: (id: string, input: { reasonCode: DeclineReasonCode; note?: string }) =>
    post<{ text: string; textEn: string; lang: Lang }>(`/api/requests/${id}/decline/preview`, input),
  cancelItem: (batchId: string, itemId: string) => post<{ status: string }>(`/api/payouts/${batchId}/cancel-item`, { itemId }),

  /* payout rails: PayPal Payouts, and the manual fallback that records a hand-over (moves no money) */
  railSettings: () => call<RailSettingsView>('/api/rail'),
  setManualFallback: (enabled: boolean) => post<RailSettingsView>('/api/rail', { manualFallback: enabled }),
  recordManual: (batchId: string, input: { method: 'cash' | 'check' | 'other'; receiptNote: string }) =>
    post<ManualPayoutResult>(`/api/payouts/${encodeURIComponent(batchId)}/manual`, input),

  /* money */
  ledger: () => call<LedgerView>('/api/ledger'),
  reconcile: () => post<ReconcileResult>('/api/reconcile'),
  createOrder: (amountCents: number, source: DonationSource = 'PAYPAL') => post<DonationOrder>('/api/donate/order', { amountCents, source }),
  captureOrder: (orderId: string) => post<DonationCapture>(`/api/donate/order/${orderId}/capture`),
  subscriptionPlan: (amountCents: number) => post<SubscriptionPlan>('/api/donate/subscription', { amountCents }),
  subscriptionActivated: (subscriptionId: string, amountCents: number) =>
    post<{ ok: boolean; simulated: boolean }>('/api/donate/subscription/activated', { subscriptionId, amountCents }),
  report: () => call<ReportView>('/api/report'),

  /* demo */
  play: (scenario: ScenarioId, mode: PlayMode, speed?: number) => post<ScenarioRun>('/api/demo/play', { scenario, mode, speed }),
  reset: () => post<{ ok: true }>('/api/demo/reset'),
};

/**
 * Subscribe to GET /api/stream. Returns a close function.
 * EventSource reconnects on its own; `onStatus` reports connection health for the UI.
 */
export function openStream(
  onMessage: (m: StreamMessage) => void,
  opts: { requestId?: string; onStatus?: (s: 'open' | 'reconnecting') => void } = {},
): () => void {
  const url = `/api/stream${opts.requestId ? `?requestId=${encodeURIComponent(opts.requestId)}` : ''}`;
  const es = new EventSource(url);
  const handle = (e: MessageEvent<string>) => {
    try {
      onMessage(JSON.parse(e.data) as StreamMessage);
    } catch {
      /* ignore malformed frames */
    }
  };
  es.addEventListener('stage', handle as EventListener);
  es.addEventListener('hello', handle as EventListener);
  es.onopen = () => opts.onStatus?.('open');
  es.onerror = () => opts.onStatus?.('reconnecting');
  return () => es.close();
}
