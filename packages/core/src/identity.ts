/**
 * Household identity for caps: the normalized payout destination (and optionally a phone).
 * This is about the payment rail, not the person: we never infer identity from names or text.
 */
import type { HistoryEntry, PayoutDestination, RequestStatus } from './schemas.js';

export const DAY_MS = 86_400_000;

/** Requests in these states count against caps and velocity (money committed or in flight). */
export const COUNTED_STATUSES: ReadonlySet<RequestStatus> = new Set<RequestStatus>([
  'awaiting_approval',
  'approved',
  'paying',
  'paid',
  'unclaimed',
]);

/** Digits only; US numbers reduced to their last 10 digits so "+1 (555) 010-2000" == "5550102000". */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export function normalizeDestinationValue(dest: Pick<PayoutDestination, 'type' | 'value'>): string {
  const v = dest.value.normalize('NFKC').trim().toLowerCase();
  switch (dest.type) {
    case 'EMAIL':
      return v;
    case 'USER_HANDLE':
      return v.replace(/^@+/, '');
    case 'PHONE':
      return normalizePhone(v);
  }
}

/** Stable key; wallet-agnostic on purpose (same email on PayPal and Venmo is one rail endpoint). */
export function destinationKey(dest: Pick<PayoutDestination, 'type' | 'value'>): string {
  return `${dest.type}:${normalizeDestinationValue(dest)}`;
}

export function sameHousehold(
  a: { destination: PayoutDestination | null; phone?: string | undefined },
  b: { destination: PayoutDestination; phone?: string | undefined },
): boolean {
  if (a.destination && destinationKey(a.destination) === destinationKey(b.destination)) return true;
  if (a.phone && b.phone) {
    const pa = normalizePhone(a.phone);
    return pa.length >= 7 && pa === normalizePhone(b.phone);
  }
  return false;
}

export function toDate(d: string | Date | undefined): Date {
  if (d === undefined) return new Date();
  const out = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(out.getTime())) throw new RangeError(`invalid date: ${String(d)}`);
  return out;
}

/** History entries for the same household that count, within the last `days` days of `now`. */
export function householdWindow(
  history: readonly HistoryEntry[],
  who: { destination: PayoutDestination | null; phone?: string | undefined },
  now: Date,
  opts: { days?: number; excludeRequestId?: string | undefined } = {},
): HistoryEntry[] {
  const since = now.getTime() - (opts.days ?? 30) * DAY_MS;
  return history.filter((h) => {
    if (opts.excludeRequestId && h.requestId === opts.excludeRequestId) return false;
    if (!COUNTED_STATUSES.has(h.status)) return false;
    const t = new Date(h.createdAt).getTime();
    if (Number.isNaN(t) || t <= since || t > now.getTime()) return false;
    return sameHousehold(who, h);
  });
}
