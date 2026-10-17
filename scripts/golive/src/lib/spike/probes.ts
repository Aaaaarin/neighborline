/**
 * Probes whose exact answers PayPal does not document: the duplicate sender_batch_id error, the HTTP status of each
 * sandbox negative-testing value, and cancelling an UNCLAIMED item. Every probe records the raw shape.
 */
import { buildPayoutRequest, findExistingBatchId, isDuplicateSenderBatchError, PayPalApiError, type PayPal } from '@neighborline/paypal';
import { errorShape } from '../paypal-admin.js';
import type { PlannedBatch } from './payouts.js';

/** JSON paths of every href that points at a payout batch, e.g. `details[0].link[0].href`. */
export function batchLinkPaths(body: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 6 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (k === 'href' && typeof x === 'string' && /\/v1\/payments\/payouts\/[A-Za-z0-9]+/.test(x)) out.push(p);
      else visit(x, p, depth + 1);
    }
  };
  visit(body, '', 0);
  return out;
}

export interface DuplicateProbe {
  /** The raw answer to a second POST with the same sender_batch_id and a new PayPal-Request-Id. */
  reused: { status?: number; name?: string; issue?: string; message?: string; debugId?: string; linkPaths: string[]; body?: unknown; unexpectedBatchId?: string };
  detectedAsDuplicate: boolean;
  linkedBatchId: string | undefined;
  linkMatchesOriginal: boolean;
  /** payouts.createBatch with a new request id: should resolve to the original batch with duplicate:true. */
  client: { duplicate?: boolean; batchId?: string; error?: string; name?: string };
  /** Same PayPal-Request-Id as the original create: PayPal should replay the original batch. */
  replay: { status?: number; batchId?: string; error?: ReturnType<typeof errorShape> };
  ok: boolean;
}

export async function probeDuplicate(pp: PayPal, plan: PlannedBatch, originalBatchId: string, runId: string): Promise<DuplicateProbe> {
  const body = buildPayoutRequest(plan.input);
  const probe: DuplicateProbe = { reused: { linkPaths: [] }, detectedAsDuplicate: false, linkedBatchId: undefined, linkMatchesOriginal: false, client: {}, replay: {}, ok: false };
  try {
    const r = await pp.client.request<{ batch_header: { payout_batch_id: string } }>({ method: 'POST', path: '/v1/payments/payouts', body, requestId: `golive-dup-raw-${runId}`, retry: false });
    probe.reused = { status: r.status, linkPaths: [], unexpectedBatchId: r.data.batch_header?.payout_batch_id };
  } catch (err) {
    const s = errorShape(err);
    probe.reused = { ...(s.status !== undefined ? { status: s.status } : {}), name: s.name, ...(s.issue ? { issue: s.issue } : {}), message: s.message, ...(s.debugId ? { debugId: s.debugId } : {}), linkPaths: batchLinkPaths(s.body), body: s.body };
    probe.detectedAsDuplicate = isDuplicateSenderBatchError(err);
    probe.linkedBatchId = err instanceof PayPalApiError ? findExistingBatchId(err.body) : undefined;
    probe.linkMatchesOriginal = probe.linkedBatchId === originalBatchId;
  }
  try {
    const r = await pp.payouts.createBatch({ ...plan.input, requestId: `golive-dup-client-${runId}` });
    probe.client = { duplicate: r.duplicate, batchId: r.batchId };
  } catch (err) {
    probe.client = { error: (err as Error).message, name: (err as Error).name };
  }
  try {
    const r = await pp.client.request<{ batch_header: { payout_batch_id: string } }>({ method: 'POST', path: '/v1/payments/payouts', body, requestId: plan.input.senderBatchId, retry: false });
    probe.replay = { status: r.status, batchId: r.data.batch_header?.payout_batch_id };
  } catch (err) {
    probe.replay = { error: errorShape(err) };
  }
  probe.ok = probe.client.duplicate === true && probe.client.batchId === originalBatchId;
  return probe;
}

/** The fake's guesses (tools/fake-paypal/src/routes/payouts-negative.ts): the docs give no HTTP statuses. */
export const FAKE_ASSUMED_STATUS: Record<string, number> = {
  ERRPYO001: 422, ERRPYO002: 422, ERRPYO003: 403, ERRPYO005: 422, ERRPYO006: 500, ERRPYO010: 400, ERRPYO011: 403, ERRPYO012: 422,
  ERRPYO013: 400, ERRPYO014: 422, ERRPYO035: 429, ERRPYO036: 504, ERRPYO038: 422, ERRPYO039: 409, ERRPYO040: 422, POSPYO001: 201, POSPYO003: 201,
};

export interface NegativeResult {
  code: string;
  where: string;
  status?: number;
  name?: string;
  issue?: string;
  debugId?: string;
  batchId?: string;
  fakeAssumes?: number;
}

const CREATE_CODES = ['ERRPYO001', 'ERRPYO002', 'ERRPYO003', 'ERRPYO005', 'ERRPYO006', 'ERRPYO010', 'ERRPYO011', 'ERRPYO012', 'ERRPYO014', 'ERRPYO035', 'ERRPYO036', 'ERRPYO038', 'ERRPYO039', 'ERRPYO040', 'POSPYO001'];

async function attempt(fn: () => Promise<{ status: number; data: any }>): Promise<Omit<NegativeResult, 'code' | 'where'>> {
  try {
    const r = await fn();
    return { status: r.status, ...(r.data?.batch_header?.payout_batch_id ? { batchId: r.data.batch_header.payout_batch_id } : {}), ...(r.data?.batch_header?.batch_status ? { name: r.data.batch_header.batch_status } : r.data?.transaction_status ? { name: r.data.transaction_status } : {}) };
  } catch (err) {
    const s = errorShape(err);
    return { ...(s.status !== undefined ? { status: s.status } : {}), name: s.name, ...(s.issue ? { issue: s.issue } : {}), ...(s.debugId ? { debugId: s.debugId } : {}) };
  }
}

/** Sandbox negative-testing values (docs.paypal.ai/send/test-go-live). One small call each, never retried. */
export async function probeNegative(pp: PayPal, runId: string, log: (s: string) => void): Promise<NegativeResult[]> {
  const out: NegativeResult[] = [];
  const item = (note: string, wallet: 'PAYPAL' | 'VENMO' = 'PAYPAL') => ({
    recipient_type: wallet === 'VENMO' ? 'USER_HANDLE' : 'EMAIL',
    amount: { value: '1.00', currency: 'USD' },
    receiver: wallet === 'VENMO' ? 'neighborline-sandbox-test' : `neighborline-negative-${runId}@example.com`,
    recipient_wallet: wallet,
    note,
    sender_item_id: `golive_${runId}_neg_item`,
  });
  const post = (sbid: string, items: unknown[]) => () => pp.client.request<any>({ method: 'POST', path: '/v1/payments/payouts', body: { sender_batch_header: { sender_batch_id: sbid }, items }, requestId: sbid, retry: false });
  for (const code of CREATE_CODES) out.push({ code, where: 'items[0].note (create)', ...(await attempt(post(`golive_${runId}_neg_${code}`, [item(code)]))) });
  out.push({ code: 'POSPYO003', where: 'items[0].note (create, Venmo)', ...(await attempt(post(`golive_${runId}_neg_POSPYO003`, [item('POSPYO003', 'VENMO')]))) });
  out.push({ code: 'ERRPYO013', where: 'items[0].sender_batch_id (create, Venmo)', ...(await attempt(post(`golive_${runId}_neg_ERRPYO013`, [{ ...item('Venmo note present', 'VENMO'), sender_batch_id: 'ERRPYO013' }]))) });
  for (const code of ['ERRPYOB001', 'ERRPYOB002', 'ERRPYOB003', 'ERRPYOB004']) out.push({ code, where: 'GET /v1/payments/payouts/{id}', ...(await attempt(() => pp.client.request<any>({ path: `/v1/payments/payouts/${code}`, retry: false }))) });
  for (const code of ['ERRPYO047', 'ERRPYO052']) out.push({ code, where: 'GET /v1/payments/payouts-item/{id}', ...(await attempt(() => pp.client.request<any>({ path: `/v1/payments/payouts-item/${code}`, retry: false }))) });
  for (const code of ['ERRPYO007', 'ERRPYO009']) out.push({ code, where: 'POST /v1/payments/payouts-item/{id}/cancel', ...(await attempt(() => pp.client.request<any>({ method: 'POST', path: `/v1/payments/payouts-item/${code}/cancel`, requestId: `golive-${runId}-cancel-${code}`, retry: false }))) });
  for (const r of out) {
    if (FAKE_ASSUMED_STATUS[r.code] !== undefined) r.fakeAssumes = FAKE_ASSUMED_STATUS[r.code]!;
    log(`    ${r.code.padEnd(10)} ${r.where.padEnd(44)} → ${r.status ?? '—'} ${r.name ?? ''}${r.issue ? ` (${r.issue})` : ''}`);
  }
  return out;
}

export interface CancelProbe {
  payoutItemId: string;
  before: string;
  after?: string;
  error?: ReturnType<typeof errorShape>;
}

/** Cancel the UNCLAIMED item (what an organizer does for Rosa after 25 days): it should come back RETURNED. */
export async function probeCancelUnclaimed(pp: PayPal, payoutItemId: string, before: string): Promise<CancelProbe> {
  try {
    const r = await pp.payouts.cancelUnclaimedItem(payoutItemId);
    return { payoutItemId, before, after: r.paypalStatus };
  } catch (err) {
    return { payoutItemId, before, error: errorShape(err) };
  }
}
