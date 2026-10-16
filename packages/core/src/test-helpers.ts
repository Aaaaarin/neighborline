/** Test fixtures shared by core tests (not exported from index). */
import type { HistoryEntry, PayoutDestination, RequestStatus } from './schemas.js';

export const NOW = '2026-10-16T18:00:00.000Z';

export const daysAgo = (d: number, from = NOW): string => new Date(Date.parse(from) - d * 86_400_000).toISOString();

export const venmo = (value: string, nameOnFile?: string): PayoutDestination => ({
  wallet: 'VENMO',
  type: 'USER_HANDLE',
  value,
  ...(nameOnFile ? { nameOnFile } : {}),
});
export const paypal = (value: string, nameOnFile?: string): PayoutDestination => ({
  wallet: 'PAYPAL',
  type: 'EMAIL',
  value,
  ...(nameOnFile ? { nameOnFile } : {}),
});

let n = 0;
export function hist(partial: Partial<HistoryEntry> & { destination: PayoutDestination }): HistoryEntry {
  n += 1;
  return {
    requestId: partial.requestId ?? `req_h${n}`,
    createdAt: partial.createdAt ?? daysAgo(3),
    ruleKey: partial.ruleKey ?? 'groceries',
    amountCents: partial.amountCents ?? 50_00,
    status: partial.status ?? ('paid' satisfies RequestStatus),
    destination: partial.destination,
    ...(partial.phone ? { phone: partial.phone } : {}),
  };
}
