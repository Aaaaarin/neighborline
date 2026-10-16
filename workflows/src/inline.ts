/**
 * Fallback runner: execute the same task code inside the cron process, without Render Workflows.
 * Used when DISPATCH_MODE=inline (e.g. if Workflows is unavailable on the workspace or during an
 * incident). Trade-offs vs Workflows: chained runs share one instance and run in-process, retries are
 * a simple in-process loop instead of Render's per-run retry with dashboard history, and one stuck
 * job delays the next cron tick (Render runs at most one instance of a cron job at a time).
 */
import type { TaskContext, TaskDefinition } from '@renderinc/sdk/workflows';

const ATTEMPTS = 3;
const WAIT_MS = 30_000;

async function withRetry<R>(name: string, fn: () => Promise<R>): Promise<R> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      console.error(JSON.stringify({ event: 'inline_attempt_failed', task: name, attempt, error: String(err) }));
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, WAIT_MS * attempt));
    }
  }
  throw last;
}

export const inlineContext: TaskContext = {
  metadata: {},
  run<TArgs extends unknown[], TResult>(t: TaskDefinition<TArgs, TResult>, ...args: TArgs): Promise<TResult> {
    return withRetry(t.name, async () => t.func(inlineContext, ...args));
  },
};

export function runInline<TArgs extends unknown[], TResult>(t: TaskDefinition<TArgs, TResult>, ...args: TArgs): Promise<TResult> {
  return inlineContext.run(t, ...args);
}
