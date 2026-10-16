/**
 * Money at the PayPal boundary. Internally everything is integer minor units ("cents"); PayPal wants decimal
 * strings. No floats anywhere: formatting and parsing are string/integer operations.
 */
import { PayPalInputError } from './errors.js';

/** PayPal currencies that do not support decimals (https://developer.paypal.com/reference/currency-codes/). */
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

export function minorUnitDigits(currency: string): 0 | 2 {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** 15000 → "150.00"; 5 → "0.05"; JPY 1500 → "1500". Throws on non-integers/unsafe values. */
export function toPayPalValue(minorUnits: number, currency = 'USD'): string {
  if (!Number.isSafeInteger(minorUnits)) throw new PayPalInputError(`Amount must be an integer number of minor units, got ${minorUnits}`, 'amountCents');
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits);
  if (minorUnitDigits(currency) === 0) return `${sign}${abs}`;
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** "150.00" → 15000, "-0.5" → -50, "1500" (JPY) → 1500. Throws on malformed input. */
export function fromPayPalValue(value: string, currency = 'USD'): number {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new PayPalInputError(`Malformed PayPal amount "${value}"`);
  const digits = minorUnitDigits(currency);
  const frac = m[3] ?? '';
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) throw new PayPalInputError(`Amount "${value}" has more precision than ${currency} supports`);
  const minor = Number(m[2]) * 10 ** digits + (digits ? Number(frac.slice(0, digits).padEnd(digits, '0')) : 0);
  if (!Number.isSafeInteger(minor)) throw new PayPalInputError(`Amount "${value}" is out of range`);
  return m[1] ? -minor : minor;
}

export interface PayPalMoney {
  currency: string;
  value: string;
}
export interface PayPalAmount {
  currency_code: string;
  value: string;
}

export const money = (amountCents: number, currency = 'USD'): PayPalMoney => ({ currency, value: toPayPalValue(amountCents, currency) });
export const amount = (amountCents: number, currency = 'USD'): PayPalAmount => ({ currency_code: currency, value: toPayPalValue(amountCents, currency) });
