import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import { solvePow } from '../lib/pow';

const webDir = fileURLToPath(new URL('..', import.meta.url));

/**
 * A fresh single-use invite code for an organizer, made the way an operator makes one
 * (`pnpm --filter @neighborline/web organizer-invite <id>`), in the e2e database. Each call is a new
 * code; a code enrolls one passkey once.
 */
export function inviteCode(organizerId: string): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('playwright.config sets E2E_DATABASE_URL for the invite CLI');
  return execFileSync('pnpm', ['-s', 'exec', 'tsx', 'scripts/organizer-invite.ts', organizerId, '--ttl', '1h'], {
    cwd: webDir,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Earn the human pass the way the browser does (lib/human-check-client.ts): ask for a challenge, solve
 * the proof of work, send it back. e2e runs with HUMAN_CHECK=pow, so model-using intake calls made
 * straight through the API need this first. Cookies land in `request`'s jar.
 */
export async function passHumanCheck(request: APIRequestContext): Promise<void> {
  const ch = await (await request.post('/api/human/challenge', { data: {} })).json();
  if (ch.kind !== 'pow') return;
  const solution = await solvePow(ch, { yieldFn: async () => {} });
  const res = await request.post('/api/human/verify', { data: { kind: 'pow', challenge: ch.challenge, solution } });
  if (!res.ok()) throw new Error(`human check failed: ${res.status()} ${await res.text()}`);
}
