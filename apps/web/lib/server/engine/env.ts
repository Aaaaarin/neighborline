/**
 * Runtime configuration for the real engine, read once from env (see root .env.example).
 * Everything defaults to zero-credential local mode: fake PayPal + fixture AI + in-memory PGlite.
 */
import { audioPolicy, type AudioPolicy } from '../audio-retention';

export type Env = Record<string, string | undefined>;

export interface EngineConfig {
  paypalMode: 'fake' | 'sandbox';
  aiMode: 'fixture' | 'live';
  /** Base URL of tools/fake-paypal (fake mode only). */
  fakePaypalUrl: string;
  /** Postgres URL → postgres-js; else PGlite (in memory, or under PGLITE_DIR). */
  databaseUrl: string | undefined;
  /** tools/dev-db control endpoint (local only): lets /demo reset swap in a fresh shared database. */
  devDbControlUrl: string | undefined;
  pgliteDir: string | undefined;
  groupSlug: string;
  /** Multiplier for scripted demo beats in tests (1 = real pacing). */
  beatScale: number;
  /** What happens to raw voice recordings after transcription (AUDIO_RETENTION, default none). */
  audio: AudioPolicy;
}

export function readConfig(env: Env = process.env): EngineConfig {
  const pm = (env.PAYPAL_MODE ?? 'fake').toLowerCase();
  if (pm !== 'fake' && pm !== 'sandbox') throw new Error(`PAYPAL_MODE must be fake or sandbox (got "${pm}")`);
  return {
    paypalMode: pm,
    aiMode: (env.AI_MODE ?? 'fixture').toLowerCase() === 'live' ? 'live' : 'fixture',
    fakePaypalUrl: (env.FAKE_PAYPAL_URL || 'http://localhost:4010').replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL || undefined,
    devDbControlUrl: env.DEV_DB_CONTROL_URL || undefined,
    pgliteDir: env.PGLITE_DIR || undefined,
    groupSlug: env.NEIGHBORLINE_GROUP_SLUG || 'eastside',
    beatScale: Number(env.NEIGHBORLINE_BEAT_SCALE) > 0 ? Number(env.NEIGHBORLINE_BEAT_SCALE) : 1,
    audio: audioPolicy(env),
  };
}

/** Public base URL of the app: APP_BASE_URL, else Render's RENDER_EXTERNAL_URL, else local dev. */
export function appBaseUrl(env: Env = process.env): string {
  return (env.APP_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
}
