/** Everything a route module needs: state, config, ids, clock, timers and the webhook emitter. */
import type { FakeConfig } from './config.js';
import type { IdFactory } from './ids.js';
import type { FakeState, Link } from './state.js';
import type { WebhookEmitter } from './webhook-emitter.js';

export interface FakeContext {
  state: FakeState;
  config: FakeConfig;
  ids: IdFactory;
  baseUrl(): string;
  now(): number;
  iso(ms?: number): string;
  /** setTimeout that is cancelled on reset/close. */
  schedule(fn: () => void, ms: number): void;
  webhooks: WebhookEmitter;
}

/** PayPal timestamps have second precision with `Z`. */
export function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function link(ctx: FakeContext, path: string, rel: string, method = 'GET'): Link {
  return { href: `${ctx.baseUrl()}${path}`, rel, method, encType: 'application/json' };
}

export function centsToValue(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Strict "123" / "123.4" / "123.45" → cents. Returns null when malformed. */
export function valueToCents(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(-)?(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '0').padEnd(2, '0'));
  return m[1] ? -cents : cents;
}
