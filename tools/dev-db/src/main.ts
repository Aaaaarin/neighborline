/** `pnpm --filter @neighborline/dev-db start` — env: DEV_DB_PORT (4030), DEV_DB_CONTROL_PORT (4031), DEV_DB_DIR (unset = in memory). */
import { createDevDb } from './index.js';

if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  console.error('[dev-db] refusing to start in production: use Postgres (DATABASE_URL).');
  process.exit(1);
}
const port = Number(process.env.DEV_DB_PORT ?? 4030);
const controlPort = Number(process.env.DEV_DB_CONTROL_PORT ?? port + 1);
const db = await createDevDb({
  port,
  controlPort,
  ...(process.env.DEV_DB_DIR ? { dataDir: process.env.DEV_DB_DIR } : {}),
  log: (m) => console.log(`[dev-db] ${m}`),
});
console.log(`[dev-db] embedded Postgres (PGlite) on ${db.url} · control ${db.controlUrl} · ${process.env.DEV_DB_DIR ? `data in ${process.env.DEV_DB_DIR}` : 'in memory'}`);

const shutdown = () => {
  void db.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
