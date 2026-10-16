/**
 * Make a single-use, expiring invite code for an organizer's first passkey (THREAT_MODEL R13).
 *
 *   pnpm --filter @neighborline/web organizer-invite <organizerId> [--ttl 72h]
 *
 * Prints the code once on stdout (details on stderr). The database keeps only sha256(code), the
 * expiry and, once used, when and by which passkey. Hand the code over in person or by phone.
 *
 * Database: DATABASE_URL; when it is empty, the `pnpm dev` database (tools/dev-db on
 * 127.0.0.1:$DEV_DB_PORT, default 4030). PGLITE_DIR is used only if set and DATABASE_URL is empty
 * (stop the web app first: an embedded database has one owner).
 */
import { createDb, createOrganizerInvite, migrate, parseInviteTtl, RepoError } from '@neighborline/db';

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error('usage: organizer-invite <organizerId> [--ttl 72h]   (TTL: 90m, 72h, 3d; at most 30d)');
  process.exit(1);
}

const args = process.argv.slice(2);
let organizerId: string | undefined;
let ttl: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--ttl') ttl = args[++i] ?? usage('--ttl needs a value');
  else if (a.startsWith('--ttl=')) ttl = a.slice('--ttl='.length);
  else if (a === '-h' || a === '--help') usage();
  else if (!organizerId && !a.startsWith('-')) organizerId = a;
  else usage(`unexpected argument ${a}`);
}
if (!organizerId) usage();

let ttlMs: number;
try {
  ttlMs = parseInviteTtl(ttl);
} catch (err) {
  usage(err instanceof Error ? err.message : String(err));
}

const url = process.env.DATABASE_URL || (process.env.PGLITE_DIR ? undefined : `postgres://postgres@127.0.0.1:${process.env.DEV_DB_PORT || '4030'}/postgres`);
const handle = createDb(url ? { url } : {});
try {
  await migrate(handle.db);
  const { code, invite } = await createOrganizerInvite(handle.db, { organizerId, createdBy: 'cli:organizer-invite', ttlMs });
  console.error(`Invite for ${invite.organizerId}: single use, expires ${invite.expiresAt}. It is shown only this once; only its hash is stored.`);
  console.log(code);
} catch (err) {
  if (err instanceof RepoError && err.code === 'NOT_FOUND') console.error(`No organizer "${organizerId}" in this database (seeded ids look like org_dana).`);
  else console.error(`Could not create the invite: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}
