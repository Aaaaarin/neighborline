/**
 * The web server's one logger. Every line is JSON and every string in it goes through
 * core.redactDeep, which masks emails, phone numbers and @handles except their last 2 characters
 * (SPEC §2.6). Never log request bodies, transcripts or payout destinations on purpose; this is the
 * safety net for when an error message contains one anyway.
 */
import { redactDeep, redactPII } from '@neighborline/core';

type Level = 'info' | 'warn' | 'error';

/** The message of an Error (or anything thrown), redacted. */
export function errorText(err: unknown): string {
  return redactPII(err instanceof Error ? err.message : String(err));
}

function write(level: Level, event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, svc: 'web', event, ...redactDeep(data) });
  if (level === 'info') console.log(line);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => write('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => write('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => write('error', event, data),
};
