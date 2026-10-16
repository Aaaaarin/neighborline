/** Privacy by default (SPEC §2.6): audio retention, log and trace redaction. */
import { existsSync, mkdtempSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioPolicy, disposeAudio, sweepAudio } from './audio-retention';
import { errorText, log } from './log';

describe('audio retention', () => {
  it('defaults to none: nothing is written and the buffer is wiped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nl-audio-'));
    const policy = { ...audioPolicy({}), dir };
    expect(policy.retention).toBe('none');
    const audio = new Uint8Array([1, 2, 3, 4]);
    const out = disposeAudio(policy, { requestId: 'req_1', audio, mimeType: 'audio/webm' });
    expect(out).toEqual({ retention: 'none', bytes: 4 });
    expect([...audio]).toEqual([0, 0, 0, 0]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('24h keeps an owner-only file, then the sweep deletes it after 24 hours', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'nl-audio-')), 'kept');
    const policy = audioPolicy({ AUDIO_RETENTION: '24h', AUDIO_DIR: dir });
    const now = new Date('2026-10-16T12:00:00Z');
    const out = disposeAudio(policy, { requestId: 'req_2/../x', audio: new Uint8Array([9, 9]), mimeType: 'audio/ogg;codecs=opus' }, now);
    expect(out.ref).toMatch(/^audio:req_2x-[0-9a-f]{12}\.ogg$/);
    expect(out.expiresAt).toBe('2026-10-17T12:00:00.000Z');
    const file = join(dir, out.ref!.slice('audio:'.length));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(sweepAudio(policy, new Date(Date.now() + 60_000))).toBe(0);
    utimesSync(file, new Date(Date.now() - 25 * 3_600_000), new Date(Date.now() - 25 * 3_600_000));
    expect(sweepAudio(policy)).toBe(1);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects unknown settings instead of silently keeping audio', () => {
    expect(() => audioPolicy({ AUDIO_RETENTION: 'forever' })).toThrow(/none or 24h/);
  });
});

describe('logger redaction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('masks emails, phones and handles in every field, keeps ids and amounts', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('payout.failed', { receiver: 'rosa.m.delgado@example.com', note: 'call +1 (503) 555-0142 or @lan-nguyen54', requestId: 'req_demo_3f9c', amountCents: 15000 });
    const line = JSON.parse(spy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(JSON.stringify(line)).not.toMatch(/rosa\.m|555-0142|lan-nguyen/);
    expect(line).toMatchObject({ level: 'warn', svc: 'web', event: 'payout.failed', requestId: 'req_demo_3f9c', amountCents: 15000 });
    expect(String(line.receiver).endsWith('om')).toBe(true);
  });

  it('errorText redacts thrown messages', () => {
    expect(errorText(new Error('RECEIVER_INVALID for ana.r.lopez@example.com'))).not.toContain('ana.r.lopez');
  });
});
