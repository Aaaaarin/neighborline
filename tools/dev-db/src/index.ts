/**
 * Local-only shared database for `pnpm dev` and the e2e suite.
 *
 * Production runs Postgres (Render). Locally we want zero setup, but the web app and the approver are
 * two processes and both need the same rows, so an in-process PGlite is not enough. This serves one
 * PGlite (embedded Postgres 17, WASM) over the Postgres wire protocol on loopback; both processes
 * connect with an ordinary `postgres://` URL through postgres-js, exactly like production.
 *
 * `wire.ts` hands PGlite's single session to one client at a time and keeps it until that client's
 * statement or transaction is finished, so `SELECT … FOR UPDATE` sections in @neighborline/db never
 * interleave between the two processes.
 *
 * A tiny loopback control endpoint swaps in a fresh database (`POST /reset`) for the /demo reset
 * button: the audit log is append-only by trigger, so a reset is a new database, never a DELETE.
 * Never deploy this: it has no authentication and binds 127.0.0.1 only.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { serveWire, type WireServer } from './wire.js';

export interface DevDbOptions {
  /** Postgres wire port (0 = pick a free one). Default 4030. */
  port?: number;
  /** Control HTTP port (0 = pick a free one). Default port + 1. */
  controlPort?: number;
  /** Persist under this directory (one sub-directory per generation). Default: in memory. */
  dataDir?: string;
  log?: (msg: string) => void;
}

export interface DevDb {
  /** postgres:// URL for DATABASE_URL. */
  url: string;
  /** http:// URL of the control endpoint (DEV_DB_CONTROL_URL). */
  controlUrl: string;
  generation(): number;
  reset(): Promise<number>;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';

async function openPglite(dataDir: string | undefined, gen: number): Promise<PGlite> {
  if (!dataDir) return PGlite.create();
  mkdirSync(dataDir, { recursive: true });
  return PGlite.create(join(dataDir, `db-${Date.now().toString(36)}-${gen}`));
}

export async function createDevDb(opts: DevDbOptions = {}): Promise<DevDb> {
  const log = opts.log ?? (() => {});
  let gen = 1;
  let db = await openPglite(opts.dataDir, gen);
  let port = opts.port ?? 4030;

  const startSocket = async (pg: PGlite): Promise<WireServer> => {
    const s = await serveWire(pg, { port, host: HOST });
    port = s.port;
    return s;
  };
  let socket = await startSocket(db);

  let resetting: Promise<number> | null = null;
  const reset = (): Promise<number> => {
    resetting ??= (async () => {
      const old = db;
      await socket.stop(); // drops every client connection; postgres-js reconnects on the next query
      gen += 1;
      db = await openPglite(opts.dataDir, gen);
      socket = await startSocket(db);
      await old.close().catch(() => {});
      log(`reset → generation ${gen}`);
      return gen;
    })().finally(() => {
      resetting = null;
    });
    return resetting;
  };

  const control: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, generation: gen, url: `postgres://postgres@${HOST}:${port}/postgres` });
    if (req.method === 'POST' && req.url === '/reset') {
      reset().then(
        (g) => send(200, { ok: true, generation: g }),
        (err: unknown) => send(500, { ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
      return;
    }
    send(404, { ok: false });
  });
  await new Promise<void>((resolve, reject) => {
    control.once('error', reject);
    control.listen(opts.controlPort ?? (opts.port === 0 ? 0 : (opts.port ?? 4030) + 1), HOST, () => resolve());
  });
  const controlPort = (control.address() as AddressInfo).port;

  return {
    url: `postgres://postgres@${HOST}:${port}/postgres`,
    controlUrl: `http://${HOST}:${controlPort}`,
    generation: () => gen,
    reset,
    async close() {
      await new Promise<void>((r) => control.close(() => r()));
      await socket.stop();
      await db.close().catch(() => {});
    },
  };
}
