/**
 * Runtime configuration for the real engine, read once from env (see root .env.example).
 * Everything defaults to zero-credential local mode: fake PayPal + fixture AI + in-memory PGlite.
 */
export type Env = Record<string, string | undefined>;

export interface EngineConfig {
  paypalMode: 'fake' | 'sandbox';
  aiMode: 'fixture' | 'live';
  /** Base URL of tools/fake-paypal (fake mode only). */
  fakePaypalUrl: string;
  /** Postgres URL → postgres-js; else PGlite (in memory, or under PGLITE_DIR). */
  databaseUrl: string | undefined;
  pgliteDir: string | undefined;
  groupSlug: string;
  /** Multiplier for scripted demo beats in tests (1 = real pacing). */
  beatScale: number;
}

export function readConfig(env: Env = process.env): EngineConfig {
  const pm = (env.PAYPAL_MODE ?? 'fake').toLowerCase();
  if (pm !== 'fake' && pm !== 'sandbox') throw new Error(`PAYPAL_MODE must be fake or sandbox (got "${pm}")`);
  return {
    paypalMode: pm,
    aiMode: (env.AI_MODE ?? 'fixture').toLowerCase() === 'live' ? 'live' : 'fixture',
    fakePaypalUrl: (env.FAKE_PAYPAL_URL || 'http://localhost:4010').replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || undefined,
    groupSlug: env.NEIGHBORLINE_GROUP_SLUG || 'eastside',
    beatScale: Number(env.NEIGHBORLINE_BEAT_SCALE) > 0 ? Number(env.NEIGHBORLINE_BEAT_SCALE) : 1,
  };
}
