/** Test fixture: in-memory Postgres (PGlite) + in-process fake PayPal + an approver on a random port. */
import { checkRail, computeAmount, type IntakeExtraction, type PayoutDestination } from '@neighborline/core';
import {
  addApproverTx,
  createDb,
  createOrGetApproval,
  createRequest,
  getActivePolicy,
  getApproval,
  getHistoryForDestination,
  getRailHandles,
  getRequest,
  migrate,
  seedDemo,
  updateRequest,
  type Db,
  type DbHandle,
} from '@neighborline/db';
import { PayPalClient, PayoutsApi, WebhooksApi } from '@neighborline/paypal';
import { createFakePayPal, type FakePayPal } from '@neighborline/fake-paypal';
import { approvalPayload } from '@neighborline/core';
import { contentFromRequests } from '@neighborline/db';
import { silentLogger } from './log.js';
import { APPROVER_ROUTES, signApproverRequest, type ExecuteRequest } from './protocol.js';
import { startApproverServer, type RunningApprover } from './server.js';

export const SECRET = 'test-approver-secret-0123456789abcdef';

export interface Fixture {
  handle: DbHandle;
  db: Db;
  fake: FakePayPal;
  approver: RunningApprover;
  groupId: string;
  close(): Promise<void>;
}

export async function startFixture(opts: { requirePasskeys?: boolean; demoMode?: boolean; unclaimed?: string[] } = {}): Promise<Fixture> {
  const handle = createDb({ memory: true });
  await migrate(handle.db);
  const { group } = await seedDemo(handle.db);
  const fake = await createFakePayPal({ processingDelayMs: 50, ...(opts.unclaimed ? { unclaimedReceivers: opts.unclaimed } : {}) });
  const client = new PayPalClient({ clientId: 'fake-client-id', clientSecret: 'fake-client-secret', baseUrl: fake.url });
  const approver = await startApproverServer({
    db: () => handle.db,
    payouts: new PayoutsApi(client),
    webhooks: new WebhooksApi(client),
    config: { requirePasskeys: opts.requirePasskeys ?? false, demoMode: opts.demoMode ?? true, webhookId: fake.config.webhookId },
    env: { DEMO_MODE: String(opts.demoMode ?? true) },
    log: silentLogger,
    secret: SECRET,
    health: { paypalMode: 'fake', credentials: 'fake', requirePasskeys: opts.requirePasskeys ?? false, demoMode: opts.demoMode ?? true },
  });
  return {
    handle,
    db: handle.db,
    fake,
    approver,
    groupId: group.id,
    async close() {
      await approver.close();
      await fake.close();
      await handle.close();
    },
  };
}

let seq = 0;

/** File a request through the same pure pipeline as the web app (computeAmount + checkRail → awaiting_approval). */
export async function fileRequest(
  db: Db,
  groupId: string,
  o: { dest: PayoutDestination; category?: string; requestedCents?: number; text?: string; id?: string },
): Promise<string> {
  const id = o.id ?? `req_t_${Date.now().toString(36)}_${seq++}`;
  const extraction: IntakeExtraction = {
    lang: 'en',
    summaryEn: o.text ?? 'Power out for two days, needs a heater.',
    summaryNative: o.text ?? 'Power out for two days, needs a heater.',
    category: o.category ?? 'utility_outage',
    urgency: 'today',
    requestedItems: ['space heater'],
    ...(o.requestedCents ? { requestedAmountCents: o.requestedCents } : {}),
    payout: { wallet: o.dest.wallet, type: o.dest.type, value: o.dest.value },
    missing: [],
    confidence: 0.9,
  };
  await createRequest(db, { id, groupId, channel: 'web_text', lang: 'en', originalText: extraction.summaryEn, englishText: extraction.summaryEn, extracted: extraction, payoutDestination: o.dest });
  const policy = (await getActivePolicy(db, groupId))!;
  const history = await getHistoryForDestination(db, o.dest, 30, { groupId });
  const amount = computeAmount({ policy, extraction, history, todaySpentCents: 0, destination: o.dest, requestId: id });
  const handles = await getRailHandles(db, groupId);
  const flags = checkRail({ destination: o.dest, ...handles, history, policy, text: [extraction.summaryEn], requestId: id });
  if (!amount.ok) flags.push(...amount.flags);
  await updateRequest(db, id, { status: 'awaiting_approval', confirmedByRequester: true, computed: amount.ok ? amount.computed : null, railFlags: flags, policyVersionId: policy.id }, { actor: 'test' });
  return id;
}

export async function approve(db: Db, requestIds: string[], organizers: string[]): Promise<string> {
  const { approval } = await createOrGetApproval(db, { requestIds, actor: organizers[0] });
  for (const org of organizers) {
    const r = await addApproverTx(db, { approvalId: approval.id, organizerId: org, deviceLabel: 'test phone' });
    if (!r.ok) throw new Error(`addApprover ${org}: ${r.reason}`);
  }
  return approval.id;
}

/** The request the web app sends: payload rebuilt from the database, approvers from the record. */
export async function executeBody(db: Db, approvalId: string): Promise<ExecuteRequest> {
  const a = (await getApproval(db, approvalId))!;
  const reqs = await Promise.all(a.requestIds.map(async (id) => (await getRequest(db, id))!));
  const payload = approvalPayload(contentFromRequests(reqs)) as unknown as ExecuteRequest['payload'];
  return {
    approvalId,
    hash: a.hash,
    payload,
    approvers: a.approvers.map((x) => ({ organizerId: x.organizerId, at: x.at, deviceLabel: x.deviceLabel, assertion: x.assertion ? { kind: x.assertion.kind, credentialId: x.assertion.credentialId } : null })),
  };
}

export async function call(
  url: string,
  path: string,
  body: unknown,
  opts: { secret?: string; nonce?: string; nowMs?: number; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Record<string, string> }> {
  const raw = JSON.stringify(body);
  const headers = opts.headers ?? signApproverRequest(opts.secret ?? SECRET, 'POST', path, raw, { ...(opts.nonce ? { nonce: opts.nonce } : {}), ...(opts.nowMs ? { nowMs: opts.nowMs } : {}) });
  const res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, headers };
}

export const execute = (f: Fixture, body: unknown, opts?: Parameters<typeof call>[3]) => call(f.approver.url, APPROVER_ROUTES.execute, body, opts);
