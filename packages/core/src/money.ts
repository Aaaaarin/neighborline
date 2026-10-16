/** Money helpers. All amounts are integer cents; strings exist only at display/PayPal edges. */

export function assertCents(cents: number, what = 'amount'): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`${what} must be integer cents, got ${cents}`);
}

/** "$150" for whole dollars, "$150.50" otherwise. Negative values get a leading "-". */
export function formatUsd(cents: number): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const whole = dollars.toLocaleString('en-US');
  return rem === 0 ? `${sign}$${whole}` : `${sign}$${whole}.${String(rem).padStart(2, '0')}`;
}

/** PayPal boundary format: "150.00". Throws on negatives. */
export function toPayPalValue(cents: number): string {
  assertCents(cents);
  if (cents < 0) throw new RangeError('PayPal amounts cannot be negative');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Parse "150", "150.5", "150.50", "$1,500.00" → cents. Returns null for anything else. */
export function parseUsdToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
  return whole * 100 + frac;
}
