import { describe, expect, it } from 'vitest';
import { candidateUrls, expectedSignature, parseForm, urlVariants, validateSignature } from './signature';

/**
 * Vectors: (1) the classic example from Twilio's request-validation docs and SDK READMEs (auth token
 * "12345", https://mycompany.com/myapp.php?foo=1&bar=2, five call parameters → 0/KCTR6DLpKmkAf8muzZqo1nDgQ=);
 * (2) vectors computed with the official twilio-node 5.13.1 `getExpectedTwilioSignature`, to pin our
 * implementation to the SDK's (URL with our query string; non-ASCII values).
 */
const DOC_PARAMS = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };

describe('X-Twilio-Signature', () => {
  it('matches Twilio’s documented example', () => {
    expect(expectedSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', DOC_PARAMS)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(validateSignature('12345', '0/KCTR6DLpKmkAf8muzZqo1nDgQ=', ['https://mycompany.com/myapp.php?foo=1&bar=2'], DOC_PARAMS)).toBe(true);
  });

  it('matches twilio-node 5.13.1 on our own webhook shapes', () => {
    const token = 'test_auth_token_0123456789abcdef';
    const recorded = {
      AccountSid: 'AC00000000000000000000000000000000',
      CallSid: 'CA11111111111111111111111111111111',
      From: '+15035550123',
      To: '+15035550199',
      RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Recordings/RE22222222222222222222222222222222',
      RecordingDuration: '14',
      Digits: 'hangup',
    };
    expect(expectedSignature(token, 'https://neighborline.example/api/voice/recorded?rid=req_phone_abc&step=main', recorded)).toBe('DgjuwV1vCHbAZk6BeOq7ZwF5WjI=');
    const unicode = { CallSid: 'CA1', From: '+15035550123', To: '+15035550199', Caller: '+15035550123', Body: 'tiếng Việt & ünïcode' };
    expect(expectedSignature(token, 'https://neighborline.example/api/voice/incoming', unicode)).toBe('aHx2weilzgIem5eeeyUm+9yR0qY=');
  });

  it('rejects a wrong token, a changed parameter, a changed URL and a missing header', () => {
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const good = '0/KCTR6DLpKmkAf8muzZqo1nDgQ=';
    expect(validateSignature('54321', good, [url], DOC_PARAMS)).toBe(false);
    expect(validateSignature('12345', good, [url], { ...DOC_PARAMS, Digits: '1235' })).toBe(false);
    expect(validateSignature('12345', good, [url.replace('foo=1', 'foo=2')], DOC_PARAMS)).toBe(false);
    expect(validateSignature('12345', '', [url], DOC_PARAMS)).toBe(false);
    expect(validateSignature('12345', null, [url], DOC_PARAMS)).toBe(false);
    expect(validateSignature('', good, [url], DOC_PARAMS)).toBe(false);
  });

  it('accepts Twilio signing with or without the default port, like the SDK', () => {
    const sig = expectedSignature('12345', 'https://mycompany.com:443/myapp.php?foo=1&bar=2', DOC_PARAMS);
    expect(validateSignature('12345', sig, ['https://mycompany.com/myapp.php?foo=1&bar=2'], DOC_PARAMS)).toBe(true);
    expect(validateSignature('12345', '0/KCTR6DLpKmkAf8muzZqo1nDgQ=', ['https://mycompany.com:443/myapp.php?foo=1&bar=2'], DOC_PARAMS)).toBe(true);
    expect(urlVariants('https://a.example/x')).toEqual(['https://a.example/x', 'https://a.example:443/x']);
  });

  it('repeated parameters contribute each distinct value, sorted', () => {
    const p = parseForm('A=2&A=1&A=2&B=x');
    expect(p).toEqual({ A: ['2', '1', '2'], B: 'x' });
    expect(expectedSignature('t', 'https://h/x', p)).toBe(expectedSignature('t', 'https://h/x', { A: ['1', '2'], B: 'x' }));
  });

  it('checks the public URL first when the app sits behind a proxy', () => {
    const req = new Request('http://127.0.0.1:3980/api/voice/incoming?x=1', { method: 'POST', headers: { host: '127.0.0.1:3980', 'x-forwarded-host': 'line.example', 'x-forwarded-proto': 'https' } });
    expect(candidateUrls(req, 'https://public.example/')).toEqual([
      'https://public.example/api/voice/incoming?x=1',
      'https://line.example/api/voice/incoming?x=1',
      'http://127.0.0.1:3980/api/voice/incoming?x=1',
    ]);
  });
});
