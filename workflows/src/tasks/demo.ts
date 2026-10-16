/**
 * Nightly reset of the hosted demo (DEMO_MODE only). The web app's POST /api/demo/reset is not public:
 * it needs the same HMAC as /api/internal/*, so only this job (or an operator with the secret) can
 * reseed. Stages with a run in flight get `event: reset` and offer a replay.
 */
import { task, type TaskContext } from '@renderinc/sdk/workflows';
import { ENDPOINTS } from '../contract.js';
import { connect } from './shared.js';

export const nightlyDemoReset = task(
  { name: 'nightlyDemoReset', retry: { maxRetries: 2, waitDurationMs: 60_000, backoffScaling: 2 }, timeoutSeconds: 300 },
  async function nightlyDemoReset(_ctx: TaskContext): Promise<{ ok: boolean }> {
    const { api } = connect();
    return api.post<Record<string, never>, { ok: boolean }>(ENDPOINTS.demoReset, {});
  },
);
