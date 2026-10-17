import { describe, expect, it } from 'vitest';
import { uniqueDeviceLabel } from './labels';

describe('uniqueDeviceLabel', () => {
  it('keeps a label nobody else uses', () => {
    expect(uniqueDeviceLabel('Priya’s Mac · Safari', ['Priya’s iPhone · Safari'])).toBe('Priya’s Mac · Safari');
  });

  it('numbers a repeat: "Priya’s Mac · Chrome 2", then 3', () => {
    const taken = ['Priya’s Mac · Chrome'];
    expect(uniqueDeviceLabel('Priya’s Mac · Chrome', taken)).toBe('Priya’s Mac · Chrome 2');
    expect(uniqueDeviceLabel('Priya’s Mac · Chrome', [...taken, 'Priya’s Mac · Chrome 2'])).toBe('Priya’s Mac · Chrome 3');
  });

  it('ignores case and spacing when comparing', () => {
    expect(uniqueDeviceLabel('priya’s  passkey', ['Priya’s passkey'])).toBe('priya’s passkey 2');
  });

  it('stays within 60 characters', () => {
    const long = 'x'.repeat(60);
    const out = uniqueDeviceLabel(long, [long]);
    expect(out).toHaveLength(60);
    expect(out.endsWith(' 2')).toBe(true);
  });
});

describe('guessDeviceLabel (the enrollment form’s default)', async () => {
  const { guessDeviceLabel } = await import('../../passkey-client');
  it('names the device and the browser', () => {
    expect(guessDeviceLabel('Dana', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15')).toBe('Dana’s Mac · Safari');
    expect(guessDeviceLabel('Priya', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0')).toBe('Priya’s Windows PC · Edge');
    expect(guessDeviceLabel('Marcus', 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36')).toBe('Marcus’s Android phone · Chrome');
    expect(guessDeviceLabel('Dana', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1')).toBe('Dana’s iPhone · Chrome');
    expect(guessDeviceLabel('Dana', '')).toBe('Dana’s device');
  });
});
