import { randomUUID } from 'node:crypto';
import type { Db, Executor, Tx } from './client.js';

export type RepoErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'NOT_APPROVABLE' | 'NOT_EXECUTABLE';

export class RepoError extends Error {
  constructor(readonly code: RepoErrorCode, message: string) {
    super(message);
    this.name = 'RepoError';
  }
}

/** Short, URL-safe, prefixed ids: req_3f9c… */
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

/** Run in a transaction (a savepoint when already inside one). */
export function inTx<T>(ex: Executor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (ex as Db).transaction(fn);
}

export const iso = (d: Date): string => d.toISOString();
export const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);
