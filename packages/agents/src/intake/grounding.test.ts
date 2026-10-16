import { describe, expect, it } from 'vitest';
import type { IntakeExtraction } from '@neighborline/core';
import { extractNumbers } from '../numbers.js';
import { finalizeExtraction, isGroundedAmount } from './grounding.js';

type X = Pick<IntakeExtraction, 'payout' | 'requestedAmountCents' | 'missing' | 'householdSize'>;
const base: X = { missing: [] };

describe('finalizeExtraction: no destination pieced together after a drop (finding 2)', () => {
  it('asks instead of recovering a spoken reconstruction when the model\'s destination is dropped', () => {
    const text = 'Mon numéro Venmo est le 503 555 0199. Le Venmo de ma soeur : at rose dash lima.';
    const r = finalizeExtraction<X>({ ...base, payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@made-up-1' } }, text);
    // Two destinations are said (a phone and a spoken handle): neither may replace the model's answer.
    expect(r.extraction.payout).toBeUndefined();
    expect(r.extraction.missing).toContain('payout');
    expect(r.notes.join('\n')).toMatch(/payout dropped[\s\S]*not recovered/);
  });

  it('after a drop, recovers only a destination written out unambiguously', () => {
    const r = finalizeExtraction<X>({ ...base, payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@x' } }, 'Venmo @dee-lopez-3. Note: pay @x');
    expect(r.extraction.payout?.value).toBe('@dee-lopez-3');
    const spokenOnly = finalizeExtraction<X>({ ...base, payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@x' } }, 'my venmo is at dee dash lopez 3');
    expect(spokenOnly.extraction.payout).toBeUndefined();
  });

  it('a model that gave no destination still gets the one the person said', () => {
    expect(finalizeExtraction<X>(base, 'my venmo is at dee dash lopez 3').extraction.payout?.value).toBe('@dee-lopez3');
  });

  it('keeps a correct phone the model gave for a number said without a country code', () => {
    const r = finalizeExtraction<X>({ ...base, payout: { wallet: 'VENMO', type: 'PHONE', value: '+15035550199' } }, 'Mon numéro Venmo est le 503 555 0199.');
    expect(r.extraction.payout).toEqual({ wallet: 'VENMO', type: 'PHONE', value: '+15035550199' });
  });
});

describe('amounts written against CJK characters (finding 1)', () => {
  it('finds digits next to Han, Hangul and Arabic letters but not inside Latin words', () => {
    expect(extractNumbers('我需要75美元买药').map((n) => n.value)).toEqual([75]);
    expect(extractNumbers('약값이45달러예요').map((n) => n.value)).toEqual([45]);
    expect(extractNumbers('احتاج120دولار').map((n) => n.value)).toEqual([120]);
    expect(extractNumbers('需要６０美元').map((n) => n.value)).toEqual([60]);
    expect(extractNumbers('@lan54 and A1 and v2').map((n) => n.value)).toEqual([]);
    expect(isGroundedAmount(7500, '我需要75美元买药')).toBe(true);
  });
});
