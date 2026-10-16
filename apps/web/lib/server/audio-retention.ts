/**
 * Raw voice audio retention (SPEC §2.6 "audio deleted after transcription").
 *
 *   AUDIO_RETENTION=none (default)  the recording is transcribed in memory and never written anywhere;
 *                                   the buffer is zero-filled right after transcription. Only the
 *                                   transcript (and its translation) is stored.
 *   AUDIO_RETENTION=24h             the recording is written to AUDIO_DIR (default <tmp>/neighborline-audio,
 *                                   file mode 0600) so an organizer can re-check a misheard handle, and
 *                                   deleted 24 hours later by a sweep that also runs at every boot.
 *
 * Either way an audit row records what happened to the audio (size and retention, never content).
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export type AudioRetention = 'none' | '24h';
export const RETENTION_MS: Record<AudioRetention, number> = { none: 0, '24h': 24 * 3_600_000 };

export interface AudioPolicy {
  retention: AudioRetention;
  dir: string;
}

export function audioPolicy(env: Record<string, string | undefined> = process.env): AudioPolicy {
  const v = (env.AUDIO_RETENTION ?? 'none').trim().toLowerCase();
  if (v !== 'none' && v !== '24h') throw new Error(`AUDIO_RETENTION must be none or 24h (got "${v}")`);
  return { retention: v, dir: env.AUDIO_DIR || join(tmpdir(), 'neighborline-audio') };
}

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };

export interface AudioOutcome {
  retention: AudioRetention;
  bytes: number;
  /** Set only when retained: `audio:<file name>` (stored on the request as audioRef). */
  ref?: string;
  expiresAt?: string;
}

/**
 * Call once the transcript exists. With `none` the bytes are wiped in place; with `24h` they are
 * written with owner-only permissions and wiped from memory too.
 */
export function disposeAudio(policy: AudioPolicy, input: { requestId: string; audio: Uint8Array; mimeType: string }, now = new Date()): AudioOutcome {
  const bytes = input.audio.byteLength;
  try {
    if (policy.retention === 'none') return { retention: 'none', bytes };
    mkdirSync(policy.dir, { recursive: true, mode: 0o700 });
    const ext = EXT[input.mimeType.split(';')[0]!.trim()] ?? 'bin';
    const safeId = input.requestId.replace(/[^a-zA-Z0-9_-]/g, '');
    const name = `${safeId}-${randomBytes(6).toString('hex')}.${ext}`;
    writeFileSync(join(policy.dir, name), input.audio, { mode: 0o600 });
    return { retention: '24h', bytes, ref: `audio:${name}`, expiresAt: new Date(now.getTime() + RETENTION_MS['24h']).toISOString() };
  } finally {
    input.audio.fill(0);
  }
}

/** Delete retained recordings older than the retention window. Returns how many were deleted. */
export function sweepAudio(policy: AudioPolicy, now = new Date()): number {
  let n = 0;
  let names: string[];
  try {
    names = readdirSync(policy.dir);
  } catch {
    return 0;
  }
  const maxAge = policy.retention === 'none' ? 0 : RETENTION_MS[policy.retention];
  for (const name of names) {
    const p = join(policy.dir, name);
    try {
      if (now.getTime() - statSync(p).mtimeMs >= maxAge) {
        rmSync(p, { force: true });
        n++;
      }
    } catch {
      /* already gone */
    }
  }
  return n;
}
