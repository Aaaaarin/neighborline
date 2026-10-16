import { describe, expect, it } from 'vitest';
import { maskKeepLast, redactDeep, redactPII } from './redact.js';

describe('redactPII', () => {
  it('masks emails except the last 2 characters', () => {
    expect(redactPII('send to rosa.m.delgado@example.com please')).toBe(`send to ${'•'.repeat(24)}om please`);
  });

  it('masks phone numbers in common formats', () => {
    expect(redactPII('call +1 (503) 555-0142 now')).toBe(`call ${'•'.repeat(15)}42 now`);
    expect(redactPII('text 503.555.0142')).toBe(`text ${'•'.repeat(10)}42`);
    expect(redactPII('5035550142')).toBe(`${'•'.repeat(8)}42`);
  });

  it('masks Venmo and social handles', () => {
    expect(redactPII('Venmo @lan-nguyen54 thanks')).toBe(`Venmo ${'•'.repeat(11)}54 thanks`);
    expect(redactPII('"@eastside-mutuaiaid" looks like "@eastside-mutualaid"')).not.toMatch(/eastside/);
  });

  it('leaves amounts, ids, timestamps and short numbers alone', () => {
    const s = 'paid $150.00 · req_demo_3f9c2a · 2026-10-16T13:22:11.000Z · 3 items · nl_4f2a9c00e1';
    expect(redactPII(s)).toBe(s);
  });

  it('is idempotent', () => {
    const once = redactPII('rosa@example.com @lan-nguyen54 503-555-0142');
    expect(redactPII(once)).toBe(once);
  });

  it('maskKeepLast handles short values', () => {
    expect(maskKeepLast('ab')).toBe('••');
    expect(maskKeepLast('abc')).toBe('•bc');
  });

  it('redactDeep walks objects and arrays', () => {
    expect(redactDeep({ a: ['x @lan-nguyen54'], n: 5, nested: { e: 'rosa@example.com' } })).toEqual({
      a: [`x ${'•'.repeat(11)}54`],
      n: 5,
      nested: { e: `${'•'.repeat(14)}om` },
    });
  });
});
