/** `pnpm --filter @neighborline/db seed` — migrate and seed the demo group into DATABASE_URL or ./.pglite */
import { createDb } from '../client.js';
import { migrate } from '../migrate.js';
import { seedDemo } from '../seed.js';

const handle = createDb();
try {
  const { applied } = await migrate(handle.db);
  const res = await seedDemo(handle.db);
  console.log(`[${handle.kind}] migrations applied: ${applied.join(', ') || 'none'}; ${res.alreadySeeded ? 'already seeded' : 'seeded'} ${res.group.name}`);
} finally {
  await handle.close();
}
