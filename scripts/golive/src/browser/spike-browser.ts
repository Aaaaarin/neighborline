/**
 * The sandbox spike, in a browser tab. For when the machine that runs `pnpm golive` cannot reach
 * api-m.sandbox.paypal.com but a browser on developer.paypal.com can (PayPal's sandbox API answers CORS there).
 *
 * Bundled by src/browser/build.ts into one IIFE (dist-browser/spike.js) that sets `window.NLSpike`. It runs the same
 * parts as src/steps/sandbox-spike.ts, in the same order, with the same lib functions, and returns the same SpikeData
 * JSON, which `pnpm golive:ingest <file>` turns into golive-out/ evidence. Credentials come only from the tab's
 * sessionStorage (`nl_main`, `nl_payouts`: JSON {id, sec}); the returned JSON is scrubbed of them and of any token.
 * Not run here: the local webhook receiver (needs a server) and the Playwright buyer (the order waits for a human
 * to approve it; then NLSpike.capture).
 */
import { createPayPal, PayPalClient, type PayPal } from '@neighborline/paypal';
import { SANDBOX_URL } from '../lib/env.js';
import type { SpikeData } from '../lib/evidence.js';
import { errorShape, oauthInfo } from '../lib/paypal-admin.js';
import { captureApproved, probeOrders, type CaptureResult } from '../lib/spike/orders.js';
import { createBatchRecord, phoneProbe, planBatches, pollBatch } from '../lib/spike/payouts.js';
import { probeCancelUnclaimed, probeDuplicate, probeNegative } from '../lib/spike/probes.js';
import { probeReconcile } from '../lib/spike/reconcile.js';
import { DONE } from '../lib/spike/result.js';
import { runIdFor } from '../lib/spike/run-id.js';
import { scrubSecrets } from './secrets.js';

export interface RunOpts {
  /** Sandbox PERSONAL account that receives the PayPal-wallet payout (SANDBOX_PERSONAL_EMAIL). */
  personalEmail: string;
  venmoHandle?: string;
  /** Per batch. Default 240. */
  pollSeconds?: number;
  pollIntervalMs?: number;
  /** Only for tests: a localhost fake. Anything else but the sandbox is refused. */
  base?: string;
  log?: (s: string) => void;
  /** Default: globalThis.sessionStorage. */
  storage?: Pick<Storage, 'getItem'>;
}

type Creds = { clientId: string; clientSecret: string };
type Apps = { pp: PayPal; main: PayPal | null; creds: { payouts: Creds; main: Creds | null }; base: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The sandbox, or (tests) a localhost fake. Live PayPal and every other host are refused. */
export function resolveBase(base?: string): { base: string; target: 'sandbox' | 'fake' } {
  if (!base || base.replace(/\/+$/, '') === SANDBOX_URL) return { base: SANDBOX_URL, target: 'sandbox' };
  const u = new URL(base);
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Error(`NLSpike: base ${u.host} refused; only ${SANDBOX_URL} (or localhost for tests)`);
  return { base: u.origin, target: 'fake' };
}

function readCreds(storage: Pick<Storage, 'getItem'>, key: 'nl_main' | 'nl_payouts'): Creds | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error(`NLSpike: sessionStorage ${key} is not JSON {id, sec}`);
  }
  const { id, sec } = (v ?? {}) as { id?: unknown; sec?: unknown };
  if (typeof id !== 'string' || typeof sec !== 'string' || !id || !sec) throw new Error(`NLSpike: sessionStorage ${key} needs string fields id and sec`);
  return { clientId: id, clientSecret: sec };
}

function apps(baseOpt: string | undefined, storage?: Pick<Storage, 'getItem'>): Apps {
  const { base } = resolveBase(baseOpt);
  const st = storage ?? globalThis.sessionStorage;
  const payouts = readCreds(st, 'nl_payouts');
  if (!payouts) throw new Error('NLSpike: sessionStorage nl_payouts is missing (the Payouts app, JSON {id, sec})');
  const main = readCreds(st, 'nl_main');
  const f: typeof fetch = (...a) => globalThis.fetch(...a);
  const make = (c: Creds) => createPayPal(new PayPalClient({ ...c, baseUrl: base, fetch: f, timeoutMs: 45_000 }));
  return { pp: make(payouts), main: main ? make(main) : null, creds: { payouts, main }, base };
}

/** Everything that must never leave the tab: the credentials and the access tokens the clients hold. */
async function knownSecrets(a: Apps): Promise<string[]> {
  const out = [a.creds.payouts.clientId, a.creds.payouts.clientSecret, ...(a.creds.main ? [a.creds.main.clientId, a.creds.main.clientSecret] : [])];
  for (const p of [a.pp, a.main]) {
    if (!p) continue;
    try {
      out.push(await p.client.getAccessToken());
    } catch {
      /* no token: nothing to scrub */
    }
  }
  return out;
}

const progress: { running: boolean; runId?: string; log: string[]; error?: string; result?: SpikeData } = { running: false, log: [] };

/** The whole spike. Resolves to SpikeData (scrubbed); also kept as NLSpike.last and in sessionStorage nl_spike_last. */
export async function run(opts: RunOpts): Promise<SpikeData> {
  if (!opts?.personalEmail) throw new Error('NLSpike.run: personalEmail (a sandbox PERSONAL account email) is required');
  const a = apps(opts.base, opts.storage);
  const { target } = resolveBase(opts.base);
  const log = (s: string) => {
    progress.log.push(s);
    if (progress.log.length > 400) progress.log.shift();
    (opts.log ?? ((x: string) => console.log(`[NLSpike] ${x}`)))(s);
  };
  const now = new Date();
  const d: SpikeData = { runId: runIdFor(now), target, base: a.base, startedAt: now.toISOString(), parts: {} };
  progress.runId = d.runId;
  const mark = (part: string, status: string, note?: string) => {
    d.parts[part] = { status, at: new Date().toISOString(), ...(note ? { note } : {}) };
  };
  const finish = async () => {
    const out = scrubSecrets(d, await knownSecrets(a));
    remember(out);
    return out;
  };
  const env = { SANDBOX_PERSONAL_EMAIL: opts.personalEmail, ...(opts.venmoHandle ? { SANDBOX_VENMO_HANDLE: opts.venmoHandle } : {}) };
  const batches = planBatches(env, d.runId);
  const { pp, main } = a;
  log(`run ${d.runId} against ${a.base} (${target}); main app ${main ? 'present' : 'absent'}`);

  const adminEnv = { PAYPAL_BASE_URL: a.base, PAYPAL_PAYOUTS_CLIENT_ID: a.creds.payouts.clientId, PAYPAL_PAYOUTS_CLIENT_SECRET: a.creds.payouts.clientSecret, ...(a.creds.main ? { PAYPAL_CLIENT_ID: a.creds.main.clientId, PAYPAL_CLIENT_SECRET: a.creds.main.clientSecret } : {}) };
  const f: typeof fetch = (...x) => globalThis.fetch(...x);
  const [m, p] = await Promise.all([main ? oauthInfo(adminEnv, 'main', f) : null, oauthInfo(adminEnv, 'payouts', f)]);
  d.apps = { ...(m?.appId ? { main: m.appId } : {}), ...(p.appId ? { payouts: p.appId } : {}) };
  if (!p.ok) log(`payouts app token: ${p.status} ${p.error ?? ''}`);

  // 1. Payout batches.
  log('payouts: creating batches');
  d.batches = [];
  for (const plan of batches) {
    const rec = await createBatchRecord(pp, plan, () => new Date());
    log(`  ${rec.senderBatchId}: ${rec.batchId ? `${rec.batchId} ${rec.batchStatus}` : `refused ${rec.createError?.status} ${rec.createError?.name} ${rec.createError?.issue ?? ''}`}`);
    d.batches.push(rec);
  }
  const first = d.batches[0];
  mark('payouts', first?.batchId ? 'ok' : 'failed', first?.batchId ? undefined : `${first?.createError?.name}: ${first?.createError?.message}`);
  if (!first?.batchId) return finish();
  {
    const plan = { label: 'PHONE probe', input: phoneProbe(d.runId), items: [{ key: 'phone_1', label: 'PayPal wallet, PHONE', expect: 'refused in sandbox (documented)' }] };
    d.phone = await createBatchRecord(pp, plan, () => new Date());
    mark('phone', 'ok', d.phone.createError ? `refused: ${d.phone.createError.name}` : `accepted: ${d.phone.batchId}`);
  }

  // 2. Poll until settled.
  log('poll: waiting for item statuses');
  for (const r of d.batches) if (r.batchId) await pollBatch(pp, r, { timeoutMs: (opts.pollSeconds ?? 240) * 1000, intervalMs: opts.pollIntervalMs ?? 5000, sleep, log });
  const open = d.batches.filter((r) => r.batchId && !r.finishedPolling);
  mark('poll', open.length ? 'pending' : 'ok', open.length ? `${open.map((r) => r.batchId).join(', ')} still moving` : undefined);

  // 3. Cancel the UNCLAIMED item → RETURNED.
  const unclaimed = (first.items ?? []).find((i) => i.senderItemId?.endsWith('_unregistered') && i.status === 'UNCLAIMED');
  if (unclaimed) {
    d.cancel = await probeCancelUnclaimed(pp, unclaimed.payoutItemId, unclaimed.status);
    if (d.cancel.after) unclaimed.status = d.cancel.after;
    mark('cancel-unclaimed', d.cancel.after === 'RETURNED' ? 'ok' : 'warn', d.cancel.after ?? d.cancel.error?.name);
  }

  // 4. Duplicate sender_batch_id.
  d.duplicate = await probeDuplicate(pp, batches[0]!, first.batchId, d.runId);
  log(`duplicate: HTTP ${d.duplicate.reused.status} ${d.duplicate.reused.name}; detected ${d.duplicate.detectedAsDuplicate}; client → ${d.duplicate.client.batchId ?? d.duplicate.client.error}`);
  mark('duplicate', d.duplicate.ok ? 'ok' : 'warn', d.duplicate.ok ? undefined : 'the client did not resolve the duplicate to the original batch: see the fixture test in packages/paypal');

  // 5. Negative-testing values.
  log('negative testing values:');
  d.negative = await probeNegative(pp, d.runId, log);
  mark('negative', 'ok', `${d.negative.length} values`);

  // 6. Orders v2 (main app): created and left for a human to approve; NLSpike.capture finishes it.
  if (main) {
    log('orders (manual):');
    d.orders = await probeOrders(main, d.runId, { strategy: 'manual' }, log);
    const captured = Boolean(d.orders.capture?.captureId);
    mark('orders', d.orders.createError ? 'failed' : captured ? 'ok' : 'warn', captured ? undefined : d.orders.approval.note);
  } else mark('orders', 'skipped', 'no main app keys (sessionStorage nl_main)');

  // 7. Webhooks: list what PayPal emitted for these batches.
  const batchIds = d.batches.map((r) => r.batchId).filter((x): x is string => Boolean(x));
  try {
    const list = await pp.client.request<{ events?: Array<{ id: string; event_type: string; create_time: string; resource?: unknown }> }>({ path: '/v1/notifications/webhooks-events', query: { start_time: new Date(Date.parse(d.startedAt) - 60_000).toISOString(), page_size: 100 } });
    d.events = (list.data.events ?? []).filter((e) => batchIds.some((b) => JSON.stringify(e.resource ?? {}).includes(b))).map((e) => ({ id: e.id, type: e.event_type, createTime: e.create_time }));
    mark('webhook-events', 'ok', `${d.events.length} events`);
  } catch (err) {
    mark('webhook-events', 'warn', errorShape(err).name);
  }

  // 8. Transaction Search reconcile (main app has the permission; NLSpike.reconcileAgain after the lag).
  const newest = Math.max(0, ...d.batches.flatMap((b) => b.items ?? []).map((i) => Date.parse(i.timeProcessed ?? '') || 0));
  if (Date.now() - newest < 1_500) await sleep(1_500);
  await reconcileInto(d, main ?? pp, log, mark);
  log(`done: ${Object.entries(d.parts).filter(([, v]) => DONE.has(v.status)).length}/${Object.keys(d.parts).length} parts ok/warn`);
  return finish();
}

async function reconcileInto(d: SpikeData, rp: PayPal, log: (s: string) => void, mark: (part: string, status: string, note?: string) => void) {
  d.reconcile = await probeReconcile(rp, d.batches ?? [], new Date(), d.reconcile);
  log(`reconcile: ${d.reconcile.summary || d.reconcile.status}`);
  mark('reconcile', d.reconcile.status, d.reconcile.status === 'pending' ? `${d.reconcile.pendingLag.length} item(s) inside PayPal's 3 h Transaction Search lag; NLSpike.reconcileAgain(d) later` : d.reconcile.error?.name);
}

function checkPrev(prev: SpikeData): void {
  if (!prev || typeof prev !== 'object' || !prev.runId || !prev.parts) throw new Error('NLSpike: pass the object NLSpike.run returned');
}

/**
 * Capture an order a human approved. With an order id: returns the capture summary. With the run's SpikeData: captures
 * its order and returns the updated SpikeData (orders part ok when captured), ready to ingest.
 */
export async function capture(arg: string | SpikeData, opts: Pick<RunOpts, 'base' | 'storage' | 'log'> = {}): Promise<CaptureResult | SpikeData> {
  const isData = typeof arg !== 'string';
  if (isData) checkPrev(arg);
  const a = apps(opts.base ?? (isData ? arg.base : undefined), opts.storage);
  if (!a.main) throw new Error('NLSpike.capture: sessionStorage nl_main is missing (orders belong to the main app)');
  const log = opts.log ?? ((x: string) => console.log(`[NLSpike] ${x}`));
  const orderId = isData ? arg.orders?.orderId : arg;
  if (!orderId) throw new Error('NLSpike.capture: no order id (did the run create an order?)');
  const runId = isData ? arg.runId : `manual-${runIdFor(new Date())}`;
  const r = await captureApproved(a.main, orderId, runId, log);
  if (!isData) return scrubSecrets(r, await knownSecrets(a));
  const d: SpikeData = structuredClone(arg);
  const captured = Boolean(r.capture?.captureId);
  d.orders = { ...d.orders!, ...r, approval: captured ? { strategy: 'manual', ok: true, note: 'approved by hand in the sandbox checkout' } : d.orders!.approval };
  d.parts.orders = { status: captured ? 'ok' : 'warn', at: new Date().toISOString(), ...(captured ? {} : { note: r.captureError ? `capture: ${r.captureError.name}` : d.orders.approval.note }) };
  const out = scrubSecrets(d, await knownSecrets(a));
  remember(out);
  return out;
}

/** Re-run Transaction Search for a previous run (PayPal documents up to 3 h of lag). Returns the updated SpikeData. */
export async function reconcileAgain(prev: SpikeData, opts: Pick<RunOpts, 'base' | 'storage' | 'log'> = {}): Promise<SpikeData> {
  checkPrev(prev);
  const a = apps(opts.base ?? prev.base, opts.storage);
  const d: SpikeData = structuredClone(prev);
  const log = opts.log ?? ((x: string) => console.log(`[NLSpike] ${x}`));
  await reconcileInto(d, a.main ?? a.pp, log, (part, status, note) => {
    d.parts[part] = { status, at: new Date().toISOString(), ...(note ? { note } : {}) };
  });
  const out = scrubSecrets(d, await knownSecrets(a));
  remember(out);
  return out;
}

function remember(d: SpikeData): void {
  progress.result = d;
  try {
    globalThis.sessionStorage?.setItem('nl_spike_last', JSON.stringify(d));
  } catch {
    /* storage full or unavailable: NLSpike.last still has it */
  }
}

/** Start a run without awaiting it (for tools that time out on long calls); poll NLSpike.status(). */
export function start(opts: RunOpts): { started: boolean; note: string } {
  if (progress.running) return { started: false, note: 'a run is already in progress; see NLSpike.status()' };
  Object.assign(progress, { running: true, log: [], error: undefined, result: undefined, runId: undefined });
  run(opts)
    .catch((err: Error) => void (progress.error = err.message))
    .finally(() => void (progress.running = false));
  return { started: true, note: 'poll NLSpike.status(); when running is false, NLSpike.json() has the result' };
}

export function status() {
  const parts = progress.result?.parts;
  return { running: progress.running, runId: progress.runId, error: progress.error, done: Boolean(progress.result), parts, log: progress.log.slice(-25) };
}

/** The last result as JSON; with `chunk`, one slice of it (for tools that truncate long output). */
export function json(chunk?: number, size = 20_000): string | { chunk: number; of: number; text: string } {
  const d = progress.result ?? (() => {
    const raw = globalThis.sessionStorage?.getItem('nl_spike_last');
    return raw ? (JSON.parse(raw) as SpikeData) : undefined;
  })();
  const text = d ? JSON.stringify(d) : '';
  if (chunk === undefined) return text;
  return { chunk, of: Math.ceil(text.length / size), text: text.slice(chunk * size, (chunk + 1) * size) };
}

export const NLSpike = {
  run,
  start,
  status,
  capture,
  reconcileAgain,
  json,
  get last() {
    return progress.result;
  },
};

(globalThis as unknown as { NLSpike: typeof NLSpike }).NLSpike = NLSpike;
