import { describe, expect, it } from 'vitest';
import { createDb } from './client.js';

describe('createDb', () => {
  it('uses Postgres when a URL is given (lazy connect) and PGlite otherwise', async () => {
    const pg = createDb({ url: 'postgres://user:pw@127.0.0.1:1/none' });
    expect(pg.kind).toBe('postgres');
    await pg.close();
    const mem = createDb({ memory: true, url: 'postgres://ignored' });
    expect(mem.kind).toBe('pglite');
    await mem.close();
  });
});
