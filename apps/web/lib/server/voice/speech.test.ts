import { describe, expect, it } from 'vitest';
import type { TTS } from '@neighborline/agents';
import { ClipStore } from './clips';
import { DEFAULT_VOICES, displayNumber, hotlineNumber, parseQuietHours, readPhoneConfig } from './config';
import { PHRASE_LANGS, phrase } from './phrases';
import { createSpeaker } from './speech';
import { gatherDigits, record, response, say } from './twiml';

const ENV = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_PHONE_NUMBER: '+15035550199' };

describe('speaking on the phone', () => {
  it('uses Twilio <Say> voices where they exist and our TTS clip elsewhere', async () => {
    const cfg = readPhoneConfig(ENV);
    const clips = new ClipStore(Buffer.alloc(32, 3));
    const tts: TTS = { id: 't', speak: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg', provider: 't' }) };
    const s = createSpeaker(cfg, { tts, clips, base: '' });
    expect(await s.speak('Xin chào', 'vi')).toBe('<Say voice="Google.vi-VN-Chirp3-HD-Aoede" language="vi-VN">Xin chào</Say>');
    expect(await s.speak('Bonjou', 'ht')).toMatch(/^<Play>\/api\/voice\/audio\/[^<]+<\/Play>$/);
    // Already-synthesized read-back audio is reused, not synthesized again.
    expect(await s.speak('Bonjou', 'ht', { audioDataUrl: 'data:audio/mpeg;base64,AQID' })).toMatch(/^<Play>/);
    // Fixture TTS (browser speech placeholder) → English rendering instead of silence.
    const fixture: TTS = { id: 'f', speak: async () => ({ audio: new Uint8Array(4), mimeType: 'audio/wav', provider: 'f', useBrowserSpeech: true }) };
    expect(await createSpeaker(cfg, { tts: fixture, clips, base: '' }).speak('Bonjou', 'ht', { textEn: 'Hello' })).toBe('<Say voice="Google.en-US-Chirp3-HD-Aoede" language="en-US">Hello</Say>');
  });

  it('escapes caller-derived text in TwiML', () => {
    expect(say('<Play>http://x</Play> & "q"')).toBe('<Say>&lt;Play&gt;http://x&lt;/Play&gt; &amp; &quot;q&quot;</Say>');
    const r = response(gatherDigits({ action: '/a?x=1&y=2' }, say('hi')), record({ action: '/r?a=1&b=2', recordingStatusCallback: '/s', maxLength: 120 }));
    expect(r).toContain('action="/a?x=1&amp;y=2"');
    expect(r).toContain('maxLength="120"');
  });

  it('clip URLs are signed and expire', () => {
    let now = 1_800_000_000_000;
    const clips = new ClipStore(Buffer.alloc(32, 4), () => now);
    const token = clips.put(new Uint8Array([7]), 'audio/mpeg', 60_000);
    expect(clips.get(token)?.audio[0]).toBe(7);
    const [id, exp, sig] = token.split('.');
    expect(clips.get(`${id}.${Number(exp) + 3600}.${sig}`)).toBeNull(); // can't extend the expiry
    expect(new ClipStore(Buffer.alloc(32, 5), () => now).get(token)).toBeNull(); // other key
    now += 61_000;
    expect(clips.get(token)).toBeNull();
  });

  it('has every phone phrase in every language it lists, with the same slots', () => {
    for (const lang of PHRASE_LANGS) {
      expect(phrase('pressN', lang, { label: 'X', n: 3 }).text).toMatch(/X.*3|3.*X/);
      expect(phrase('greeting', lang).lang).toBe(lang);
    }
    expect(phrase('greeting', 'ko').text).not.toBe(phrase('greeting', 'en').text);
  });
});

describe('phone line config', () => {
  it('is on only with SID, token and number', () => {
    expect(readPhoneConfig({}).enabled).toBe(false);
    expect(readPhoneConfig({ ...ENV, TWILIO_AUTH_TOKEN: '' }).enabled).toBe(false);
    expect(readPhoneConfig(ENV).enabled).toBe(true);
    expect(hotlineNumber({})).toBeNull();
    expect(hotlineNumber(ENV)).toBe('+15035550199');
    expect(displayNumber('+15035550199')).toBe('(503) 555-0199');
  });

  it('has no Twilio voice for Haitian Creole; voices can be overridden or removed', () => {
    expect(DEFAULT_VOICES.ht).toBeUndefined();
    const cfg = readPhoneConfig({ ...ENV, TWILIO_SAY_VOICES: '{"vi":"Google.vi-VN-Standard-A","ru":null,"es":"Polly.Lupe-Neural"}' });
    expect(cfg.voices.vi).toEqual({ voice: 'Google.vi-VN-Standard-A', language: 'vi-VN' });
    expect(cfg.voices.ru).toBeUndefined();
    expect(cfg.voices.es).toEqual({ voice: 'Polly.Lupe-Neural', language: 'es-US' });
    expect(() => readPhoneConfig({ ...ENV, TWILIO_SAY_VOICES: '{' })).toThrow(/JSON/);
  });

  it('parses quiet hours', () => {
    expect(parseQuietHours(undefined)).toEqual({ start: 21, end: 8 });
    expect(parseQuietHours('off')).toBeNull();
    expect(parseQuietHours('22-7')).toEqual({ start: 22, end: 7 });
    expect(() => parseQuietHours('late')).toThrow();
    expect(() => parseQuietHours('8-8')).toThrow();
  });
});
