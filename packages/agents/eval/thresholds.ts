/**
 * CI gate. Thresholds live in eval/thresholds.json and were set from the measured fixture run with a
 * small margin (see docs/EVAL.md). A drop below them means a change to core's injection/rail rules
 * or to the extractor made the system less safe, or noisier for honest neighbors.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Metrics } from './metrics.js';

const Bounds = z
  .object({
    injectionCatchMin: z.number().min(0).max(1).optional(),
    injectionFalsePositiveBenignMax: z.number().min(0).max(1).optional(),
    impersonationCatchMin: z.number().min(0).max(1).optional(),
    impersonationCatchRailOnlyMin: z.number().min(0).max(1).optional(),
    impersonationFalsePositiveMax: z.number().min(0).max(1).optional(),
    payoutHallucinationMax: z.number().min(0).max(1).optional(),
    amountOverCapMax: z.number().min(0).max(1).optional(),
  })
  .strict();
export const Thresholds = z.object({ note: z.string().optional(), fixture: Bounds, live: Bounds }).strict();
export type Thresholds = z.infer<typeof Thresholds>;

export const THRESHOLDS_PATH = fileURLToPath(new URL('./thresholds.json', import.meta.url));
export const loadThresholds = (path: string = THRESHOLDS_PATH): Thresholds => Thresholds.parse(JSON.parse(readFileSync(path, 'utf8')));

/** Human-readable failures; empty when every bound holds. A rate with no cases fails a min bound. */
export function checkThresholds(m: Metrics, t: Thresholds, mode: 'fixture' | 'oracle' | 'live'): string[] {
  const b = mode === 'fixture' ? t.fixture : t.live;
  const out: string[] = [];
  const min = (name: string, r: number | null, bound: number | undefined) => {
    if (bound === undefined) return;
    if (r === null || r < bound) out.push(`${name} ${r === null ? 'n/a' : r.toFixed(4)} < ${bound}`);
  };
  const max = (name: string, r: number | null, bound: number | undefined) => {
    if (bound === undefined || r === null) return;
    if (r > bound) out.push(`${name} ${r.toFixed(4)} > ${bound}`);
  };
  min('injection catch rate', m.injection.catch.rate, b.injectionCatchMin);
  max('benign injection false-positive rate', m.injection.falsePositiveBenign.rate, b.injectionFalsePositiveBenignMax);
  min('impersonation catch rate (end to end)', m.impersonation.catch.rate, b.impersonationCatchMin);
  min('impersonation catch rate (rail alone)', m.impersonation.catchRailOnly.rate, b.impersonationCatchRailOnlyMin);
  max('impersonation false-positive rate', m.impersonation.falsePositive.rate, b.impersonationFalsePositiveMax);
  max('payout hallucination rate', m.safety.payoutHallucination.rate, b.payoutHallucinationMax);
  max('amount-over-cap rate', m.safety.amountOverCap.rate, b.amountOverCapMax);
  return out;
}
