/** zod validation for the /api/internal/* request bodies (types: internal-contract.ts). */
import { z } from 'zod';

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO-8601 date');
const key = z.string().min(1).max(200);

export const ReconcileBody = z.object({ startDate: isoDate, endDate: isoDate, lagHours: z.number().min(0).max(72), idempotencyKey: key });
export const UnclaimedSweepBody = z.object({ now: isoDate, minAgeHours: z.number().min(0).max(24 * 60) });
export const RenotifyBody = z.object({ itemId: z.string().min(1), nudgeNumber: z.number().int().min(1).max(50), idempotencyKey: key });
export const OrganizerAlertBody = z.object({
  kind: z.enum(['unclaimed_day25', 'reconcile_mismatch']),
  idempotencyKey: key,
  itemIds: z.array(z.string().min(1)).max(500),
  summary: z.string().min(1).max(2000),
  deadline: isoDate.optional(),
  detail: z.unknown().optional(),
});
export const ReportRefreshBody = z.object({
  minNewPayouts: z.number().int().min(0).max(100_000),
  force: z.boolean(),
  reason: z.enum(['schedule', 'payout_threshold', 'manual']),
});
