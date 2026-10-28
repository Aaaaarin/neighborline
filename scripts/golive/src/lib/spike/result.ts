/** The sandbox-spike step's summary line and status from its data (shared by the step and the browser ingest). */
import type { StepResult } from '../context.js';
import type { SpikeData } from '../evidence.js';

export const DONE = new Set(['ok', 'warn']);

export function spikeStepResult(d: SpikeData, outputs: string[], rerun = 'pnpm golive --only sandbox-spike'): StepResult {
  const statuses = Object.entries(d.parts);
  const failed = statuses.filter(([, v]) => v.status === 'failed');
  const pending = statuses.filter(([, v]) => v.status === 'pending');
  const warned = statuses.filter(([, v]) => v.status === 'warn');
  const items = (d.batches ?? []).flatMap((b) => b.items ?? []);
  const summary = `${items.map((i) => `${i.wallet[0]}:${i.status}`).join(' ')}; ${statuses.filter(([, v]) => DONE.has(v.status)).length}/${statuses.length} parts done`;
  if (failed.length) return { status: 'failed', summary, next: failed.map(([k, v]) => `${k}: ${v.note ?? 'failed'}`).join(' | '), outputs };
  if (pending.length) return { status: 'pending', summary, next: `${pending.map(([k, v]) => `${k}: ${v.note ?? 'pending'}`).join(' | ')}. Re-run: ${rerun}`, outputs };
  return { status: warned.length ? 'warn' : 'ok', summary, ...(warned.length ? { next: warned.map(([k, v]) => `${k}: ${v.note ?? 'check'}`).join(' | ') } : {}), outputs };
}
