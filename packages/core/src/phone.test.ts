import { describe, expect, it } from 'vitest';
import { phoneRuns, phonesInText, toE164 } from './phone.js';

describe('toE164', () => {
  it.each([
    ['503 555 0147', 'US', '+15035550147'],
    ['(503) 555-0147', 'US', '+15035550147'],
    ['1 503 555 0147', 'US', '+15035550147'],
    ['+1 503 555 0147', 'US', '+15035550147'],
    ['+33 6 12 34 56 78', 'US', '+33612345678'],
    ['0033 6 12 34 56 78', 'US', '+33612345678'],
    ['06 12 34 56 78', 'FR', '+33612345678'],
    ['3456 7890', 'HT', '+50934567890'],
  ])('%s (%s) → %s', (raw, region, e164) => {
    expect(toE164(raw, region)).toBe(e164);
  });
  it('rejects what cannot be a number in the region', () => {
    expect(toE164('555 0147')).toBeNull();
    expect(toE164('06 12 34 56 78', 'US')).toBeNull(); // NANP area codes never start with 0
    expect(toE164('503 555 01477')).toBeNull();
    expect(toE164('call 503 555 0147')).toBeNull();
    expect(toE164('503 555 0147', 'ZZ')).toBe('+15035550147'); // unknown region falls back to the default
  });
});

describe('phones in free text', () => {
  it('finds numbers next to any script and after other numbers', () => {
    expect(phonesInText('You can Venmo my phone number, 503 555 0147.')).toEqual(['+15035550147']);
    expect(phonesInText('我的手机号是206 555 0118。')).toEqual(['+12065550118']);
    expect(phonesInText('رقم هاتفي 313 555 0129')).toEqual(['+13135550129']);
    expect(phonesInText('We are 4. 503 555 0147')).toEqual(['+15035550147']);
    expect(phonesInText('we are 4 503 555 0147')).toEqual(['+15035550147']);
    expect(phonesInText('(206) 555-0118 or +1-857-555-0148')).toEqual(['+12065550118', '+18575550148']);
  });
  it('ignores amounts, years, dates and handles with digits', () => {
    expect(phonesInText('I owe $1,200 since 2024, due 10/12/2026')).toEqual([]);
    expect(phonesInText('Venmo @le8575550148')).toEqual([]);
    expect(phoneRuns('1.500.000 dollars')).toEqual([]);
  });
});
