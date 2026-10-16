/**
 * Short-lived audio clips for <Play> (our TTS for languages Twilio has no voice for, e.g. Haitian Creole).
 * Held in memory only, never on disk; each clip is reachable at /api/voice/audio/<token> where the token
 * is `<id>.<expiry>.<HMAC>` keyed from the Twilio auth token, so a URL can't be guessed or extended, and
 * it stops working after its TTL (10 minutes for in-call prompts, 30 for call-backs that may ring a while).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Clip {
  audio: Uint8Array;
  mimeType: string;
  expiresAt: number;
}

const MAX_CLIPS = 300;
const PROCESS_KEY = randomBytes(32);

export class ClipStore {
  private clips = new Map<string, Clip>();
  constructor(
    private readonly key: Buffer,
    private readonly now: () => number = Date.now,
  ) {}

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.key).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
  }

  put(audio: Uint8Array, mimeType: string, ttlMs = 10 * 60_000): string {
    this.prune();
    const id = randomBytes(12).toString('base64url');
    const exp = Math.floor((this.now() + ttlMs) / 1000);
    this.clips.set(id, { audio, mimeType, expiresAt: exp * 1000 });
    return `${id}.${exp}.${this.sign(id, exp)}`;
  }

  get(token: string): Clip | null {
    const m = /^([A-Za-z0-9_-]{16})\.(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(token);
    if (!m) return null;
    const [, id, expRaw, sig] = m as unknown as [string, string, string, string];
    const exp = Number(expRaw);
    const want = Buffer.from(this.sign(id, exp));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    if (exp * 1000 <= this.now()) {
      this.clips.delete(id);
      return null;
    }
    return this.clips.get(id) ?? null;
  }

  private prune() {
    const t = this.now();
    for (const [id, c] of this.clips) if (c.expiresAt <= t) this.clips.delete(id);
    while (this.clips.size >= MAX_CLIPS) {
      const first = this.clips.keys().next().value;
      if (first === undefined) break;
      this.clips.delete(first);
    }
  }

  get size(): number {
    return this.clips.size;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineClips: { key: string; store: ClipStore } | undefined;
}

/** The process-wide store, keyed from the auth token (a new token = new store, old URLs die). */
export function clipStore(authToken: string): ClipStore {
  const key = createHmac('sha256', authToken || PROCESS_KEY).update('neighborline/voice-clip/v1').digest();
  const k = key.toString('hex');
  if (globalThis.__neighborlineClips?.key !== k) globalThis.__neighborlineClips = { key: k, store: new ClipStore(key) };
  return globalThis.__neighborlineClips.store;
}
