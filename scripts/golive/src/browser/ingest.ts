/**
 * `pnpm golive:ingest <spike.json> [--out dir]`: take the SpikeData the browser spike returned (NLSpike.run /
 * capture / reconcileAgain) and write what `pnpm golive --only sandbox-spike` would have written: golive-out/state.json
 * (the sandbox-spike part and step result), golive-out/sandbox-spike.json, golive-out/SANDBOX_EVIDENCE.md and, for a
 * real sandbox run, the duplicate-error fixture in packages/paypal and the "Observed in the sandbox" block of
 * PAYPAL_NOTES.md. `pnpm golive --only finalize-docs` then picks it up. Refuses malformed data and anything that
 * looks like a credential or token.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { REPO, StateStore, rel, writeOut, type StepResult } from '../lib/context.js';
import { paypalTarget, SANDBOX_URL } from '../lib/env.js';
import { renderEvidence, type SpikeData } from '../lib/evidence.js';
import { findExtras } from '../lib/spike/extras.js';
import { updatePaypalNotes, writeDuplicateFixture } from '../lib/spike/observed.js';
import { spikeStepResult } from '../lib/spike/result.js';
import { findSecrets } from './secrets.js';

const str = z.string();
const opt = <T extends z.ZodTypeAny>(t: T) => t.optional().nullable().transform((v) => v ?? undefined);
const errShape = z.object({ status: opt(z.number()), name: str, issue: opt(str), message: opt(str), debugId: opt(str) }).passthrough();
const part = z.object({ status: z.enum(['ok', 'warn', 'pending', 'failed', 'skipped']), at: str.datetime({ offset: true }), note: opt(str) });
const item = z
  .object({ senderItemId: opt(str), payoutItemId: str, transactionId: opt(str), status: str, wallet: str, recipientType: opt(str), receiver: str, amountCents: z.number().int(), feeCents: opt(z.number().int()), timeProcessed: opt(str), errorName: opt(str), errorMessage: opt(str), purposeEcho: opt(str) })
  .passthrough();
const batch = z
  .object({ label: str, senderBatchId: str.regex(/^golive_/), batchId: opt(str), createdAt: opt(str), duplicateOnCreate: opt(z.boolean()), createError: opt(errShape), batchStatus: opt(str), timeCompleted: opt(str), items: opt(z.array(item)), plan: z.array(z.object({ key: str, label: str, expect: str })), finishedPolling: opt(z.boolean()) })
  .passthrough();

export const SpikeSchema = z
  .object({
    runId: str.regex(/^\d{8}t\d{6}$/, 'runId must look like 20261028t041944 (runIdFor)'),
    target: z.enum(['sandbox', 'fake']),
    base: str.url(),
    startedAt: str.datetime({ offset: true }),
    apps: opt(z.object({ main: opt(str), payouts: opt(str) })),
    parts: z.record(part),
    batches: opt(z.array(batch)),
    phone: opt(batch),
    cancel: opt(z.object({ payoutItemId: str, before: str, after: opt(str), error: opt(errShape) }).passthrough()),
    duplicate: opt(z.object({ reused: z.object({ linkPaths: z.array(str) }).passthrough(), detectedAsDuplicate: z.boolean(), client: z.object({}).passthrough(), replay: z.object({}).passthrough(), ok: z.boolean() }).passthrough()),
    negative: opt(z.array(z.object({ code: str, where: str }).passthrough())),
    orders: opt(z.object({ orderId: opt(str), approval: z.object({ strategy: str, ok: z.boolean(), note: str }) }).passthrough()),
    reconcile: opt(z.object({ checkedAt: str, window: z.object({ start: str, end: str }), fetched: z.number(), matched: z.array(z.object({}).passthrough()), pendingLag: z.array(str), missingAtPayPal: z.array(str), noTransactionId: z.array(str), mismatches: z.array(str), summary: str, status: z.enum(['ok', 'pending', 'warn', 'failed']) }).passthrough()),
    capture: opt(z.object({}).passthrough()),
    events: opt(z.array(z.object({ id: str, type: str, createTime: str }))),
    hosted: opt(z.object({ url: str, scenario: str }).passthrough()),
  })
  .strict();

/** Parse, refuse secrets, validate shape and target. Throws with a readable reason (never echoing a secret value). */
export function parseSpikeJson(text: string): SpikeData {
  let v: unknown;
  try {
    v = JSON.parse(text.replace(/^﻿/, ''));
    if (typeof v === 'string') v = JSON.parse(v); // a tool that returned JSON.stringify(...) as a quoted string
  } catch (err) {
    throw new Error(`not JSON: ${(err as Error).message}`);
  }
  const secrets = findSecrets(v);
  if (secrets.length) throw new Error(`refusing: the data contains what looks like a credential or token at ${secrets.slice(0, 10).join('; ')}. Re-run it in the browser (NLSpike scrubs its output) instead of editing it.`);
  const r = SpikeSchema.safeParse(v);
  if (!r.success) throw new Error(`not sandbox-spike data: ${r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  const d = v as SpikeData; // validated; keep the exact bytes the browser produced
  const target = paypalTarget({ PAYPAL_BASE_URL: d.base }); // throws for live PayPal
  if (target !== d.target) throw new Error(`target "${d.target}" does not match base ${d.base} (${target})`);
  if (target === 'sandbox' && d.base.replace(/\/+$/, '') !== SANDBOX_URL) throw new Error(`sandbox data must come from ${SANDBOX_URL}, got ${d.base}`);
  return d;
}

export interface IngestResult {
  data: SpikeData;
  result: StepResult;
  outputs: string[];
}

/**
 * Data captured by a bundle that predates `isReportingNotReady` recorded Transaction Search's 404 "Data for the given
 * start date is not available." (a new account's reporting lag) as `failed`. Re-read that same recorded response with
 * today's rule: status `pending`, every item in `pendingLag`, the raw error kept as-is. Anything else is untouched.
 */
export function reclassifyReportingLag(d: SpikeData): SpikeData {
  const r = d.reconcile;
  const e = r?.error as { status?: number; name?: string; message?: string } | undefined;
  if (!r || r.status !== 'failed' || !e || e.status !== 404) return d;
  if (e.name !== 'INVALID_REQUEST' && !/not (yet )?available/i.test(e.message ?? '')) return d;
  const ids = (d.batches ?? []).flatMap((b) => (b.items ?? []).map((i) => i.payoutItemId));
  const summary = `PayPal's reporting isn't ready yet (Transaction Search: "${e.message ?? 'not available'}"); ${ids.length} item(s) pending, try again later`;
  d.reconcile = { ...r, pendingLag: ids, status: 'pending', summary };
  const part = d.parts.reconcile;
  if (part) d.parts.reconcile = { ...part, status: 'pending', note: `${ids.length} item(s) inside PayPal's Transaction Search reporting lag (recorded 404 re-read as pending at ingest)` };
  return d;
}

export function ingestSpike(text: string, o: { repo: string; out: string; now?: () => Date }): IngestResult {
  const d = reclassifyReportingLag(parseSpikeJson(text));
  if (d.target === 'sandbox') {
    const extras = findExtras(o.repo, d.runId);
    if (extras) d.extras = extras;
  }
  const ctx = { repo: o.repo, out: o.out };
  const state = new StateStore(join(o.out, 'state.json'));
  const prev = state.get<Partial<SpikeData>>('sandbox-spike');
  if (prev.runId && prev.runId !== d.runId) {
    const hosted = prev.target === 'sandbox' && d.target === 'sandbox' && !d.hosted ? prev.hosted : undefined;
    state.reset('sandbox-spike');
    if (hosted) d.hosted = hosted; // deploy-render's hosted evidence is about the deploy, not this run
  } else if (prev.hosted && !d.hosted && d.target === 'sandbox') d.hosted = prev.hosted;
  state.patch('sandbox-spike', d as unknown as Record<string, unknown>);
  const outputs = [rel(ctx, writeOut(ctx, 'sandbox-spike.json', d)), rel(ctx, writeOut(ctx, 'SANDBOX_EVIDENCE.md', renderEvidence(d)))];
  const first = d.batches?.[0];
  if (d.target === 'sandbox') {
    if (d.duplicate && first?.batchId) {
      const fx = writeDuplicateFixture(o.repo, d.duplicate, first.batchId, d.startedAt.slice(0, 10));
      if (fx) outputs.push(fx);
    }
    const notes = updatePaypalNotes(o.repo, d);
    if (notes) outputs.push(notes);
  }
  const result = spikeStepResult(d, outputs, 'NLSpike.reconcileAgain(d) in the browser, then pnpm golive:ingest again');
  state.setStep('sandbox-spike', result, (o.now ?? (() => new Date()))());
  return { data: d, result, outputs };
}

export function parseIngestArgs(argv: readonly string[], cwd: string): { file: string; out: string } {
  let file: string | undefined;
  let out = join(REPO, 'golive-out');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a === '--out') out = resolve(cwd, argv[++i] ?? '');
    else if (a.startsWith('--out=')) out = resolve(cwd, a.slice(6));
    else if (a.startsWith('--')) throw new Error(`unknown argument "${a}"`);
    else if (!file) file = isAbsolute(a) ? a : resolve(cwd, a);
    else throw new Error(`one file only (got "${a}" too)`);
  }
  if (!file) throw new Error('usage: pnpm golive:ingest <spike.json> [--out golive-out]');
  return { file, out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { file, out } = parseIngestArgs(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd());
    const r = ingestSpike(readFileSync(file, 'utf8'), { repo: REPO, out });
    const items = (r.data.batches ?? []).flatMap((b) => b.items ?? []);
    console.log(`ingested run ${r.data.runId} (${r.data.target}, ${items.length} items) → sandbox-spike ${r.result.status}: ${r.result.summary}`);
    for (const f of r.outputs) console.log(`  wrote ${f}`);
    if (r.result.next) console.log(`  next: ${r.result.next}`);
    if (r.data.target !== 'sandbox') console.log('  (not sandbox data: no fixture, no PAYPAL_NOTES.md, and finalize-docs will not publish it)');
    else console.log('  then: pnpm golive --only finalize-docs');
  } catch (err) {
    console.error(`golive:ingest: ${(err as Error).message}`);
    process.exit(1);
  }
}
