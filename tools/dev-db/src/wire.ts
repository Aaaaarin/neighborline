/**
 * A minimal Postgres wire-protocol front for one PGlite instance, safe for several concurrent
 * clients. PGlite is a single backend session, so clients take turns: a client holds the session
 * from its first message until the database is idle again (a `Sync` or simple `Query` has completed
 * and no transaction is open). Extended-protocol sequences (Parse/Bind/Execute/Sync) and whole
 * transactions therefore never interleave between clients.
 *
 * (We tried @electric-sql/pglite-socket first: its multiplexer interleaves individual
 * extended-protocol messages from different clients outside transactions, which deadlocks
 * postgres-js under concurrency. This file is ~150 lines with no dependencies besides PGlite.)
 */
import { createServer, type Server, type Socket } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';

const SSL_REQUEST = 80877103;
const CANCEL_REQUEST = 80877102;
const GSSENC_REQUEST = 80877104;
const SYNC = Uint8Array.from([0x53, 0, 0, 0, 4]); // 'S', length 4

/** Hands the single PGlite session to one client at a time. */
class SessionLock {
  private owner: number | null = null;
  private waiters: Array<() => void> = [];

  async acquire(id: number): Promise<void> {
    while (this.owner !== null && this.owner !== id) await new Promise<void>((r) => this.waiters.push(r));
    this.owner = id;
  }

  holds(id: number): boolean {
    return this.owner === id;
  }

  release(id: number): void {
    if (this.owner !== id) return;
    this.owner = null;
    for (const w of this.waiters.splice(0)) w();
  }
}

export interface WireServer {
  port: number;
  stop(): Promise<void>;
}

export async function serveWire(db: PGlite, opts: { port: number; host: string }): Promise<WireServer> {
  await db.waitReady;
  const lock = new SessionLock();
  const sockets = new Set<Socket>();
  let nextId = 1;

  const exec = (msg: Uint8Array) => db.runExclusive(() => db.execProtocolRaw(msg));

  const handle = (socket: Socket) => {
    const id = nextId++;
    sockets.add(socket);
    socket.setNoDelay(true);
    let buf: Buffer = Buffer.alloc(0);
    let started = false;
    let chain: Promise<void> = Promise.resolve();
    let closed = false;

    const write = (out: Uint8Array) => {
      if (out.length && !closed && socket.writable) socket.write(out);
    };

    /** One complete protocol message from this client. */
    const onMessage = async (msg: Buffer, type: string | null) => {
      if (type === null) {
        const code = msg.readInt32BE(4);
        if (code === SSL_REQUEST || code === GSSENC_REQUEST) {
          write(Buffer.from('N'));
          return;
        }
        if (code === CANCEL_REQUEST) {
          socket.end();
          return;
        }
      }
      if (type === 'X') {
        socket.end();
        return;
      }
      await lock.acquire(id);
      write(await exec(msg));
      if ((type === null || type === 'S' || type === 'Q') && !db.isInTransaction()) lock.release(id);
    };

    const drain = () => {
      for (;;) {
        if (!started) {
          if (buf.length < 8) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          const msg = buf.subarray(0, len);
          buf = buf.subarray(len);
          const code = msg.readInt32BE(4);
          // The startup packet itself flips `started`; SSL/GSS requests are followed by a real startup.
          if (code !== SSL_REQUEST && code !== GSSENC_REQUEST) started = true;
          chain = chain.then(() => onMessage(Buffer.from(msg), null));
          continue;
        }
        if (buf.length < 5) return;
        const len = 1 + buf.readInt32BE(1);
        if (buf.length < len) return;
        const msg = Buffer.from(buf.subarray(0, len));
        buf = buf.subarray(len);
        const type = String.fromCharCode(msg[0]!);
        chain = chain.then(() => onMessage(msg, type));
      }
    };

    socket.on('data', (d: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      drain();
      chain = chain.catch((err: unknown) => {
        console.warn('[dev-db] protocol error:', err instanceof Error ? err.message : err);
        socket.destroy();
      });
    });
    const cleanup = () => {
      if (closed) return;
      closed = true;
      sockets.delete(socket);
      // Finish whatever this client left half-done, then hand the session on.
      chain = chain
        .catch(() => {})
        .then(async () => {
          if (!lock.holds(id)) return;
          try {
            await exec(SYNC);
            if (db.isInTransaction()) await db.runExclusive(() => db.exec('ROLLBACK'));
          } catch {
            /* the database may already be closed (reset) */
          } finally {
            lock.release(id);
          }
        });
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  };

  const server: Server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return {
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
