import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
