import { describe, expect, it } from 'vitest';
import { PayPalInputError } from './errors.js';
import { fromPayPalValue, toPayPalValue } from './money.js';

describe('cents ⇄ PayPal value strings', () => {
  it.each([
    [15000, '150.00'],
    [5, '0.05'],
    [0, '0.00'],
    [1999, '19.99'],
    [100, '1.00'],
    [-150, '-1.50'],
    [123456789, '1234567.89'],
  ])('%i cents → "%s"', (cents, value) => {
    expect(toPayPalValue(cents)).toBe(value);
    expect(fromPayPalValue(value)).toBe(cents);
  });

  it('formats zero-decimal currencies without a fraction', () => {
    expect(toPayPalValue(1500, 'JPY')).toBe('1500');
    expect(fromPayPalValue('1500', 'JPY')).toBe(1500);
  });

  it('refuses floats and unsafe integers instead of rounding money', () => {
    expect(() => toPayPalValue(150.5)).toThrow(PayPalInputError);
    expect(() => toPayPalValue(0.1 + 0.2)).toThrow(PayPalInputError);
    expect(() => toPayPalValue(Number.MAX_SAFE_INTEGER + 1)).toThrow(PayPalInputError);
  });

  it('parses PayPal strings strictly', () => {
    expect(fromPayPalValue('150')).toBe(15000);
    expect(fromPayPalValue('150.1')).toBe(15010);
    expect(fromPayPalValue('150.100')).toBe(15010);
    expect(() => fromPayPalValue('150.001')).toThrow(/precision/);
    expect(() => fromPayPalValue('1e3')).toThrow(PayPalInputError);
    expect(() => fromPayPalValue('')).toThrow(PayPalInputError);
  });
});
