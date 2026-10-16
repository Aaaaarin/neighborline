/**
 * Deploy check: run `smokeTest` with input `[]` from the Render dashboard after the first deploy.
 * Proves the workflow can reach the web app, the shared HMAC secret matches, and the internal routes
 * exist, without side effects (a report refresh with an unreachable threshold is always "not_due").
 */
import { task, type TaskContext } from '@renderinc/sdk/workflows';
import { ENDPOINTS, type HealthResponse, type ReportRefreshRequest, type ReportRefreshResponse } from '../contract.js';
import { connect } from './shared.js';

export const smokeTest = task(
  { name: 'smokeTest', retry: { maxRetries: 2, waitDurationMs: 30_000, backoffScaling: 2 }, timeoutSeconds: 300 },
  async function smokeTest(_ctx: TaskContext): Promise<{ baseUrl: string; health: HealthResponse; signedCallOk: boolean }> {
    const { cfg, api } = connect();
    const health = await api.get<HealthResponse>(ENDPOINTS.health);
    const probe = await api.post<ReportRefreshRequest, ReportRefreshResponse>(ENDPOINTS.reportRefresh, {
      minNewPayouts: Number.MAX_SAFE_INTEGER,
      force: false,
      reason: 'manual',
    });
    if (probe.regenerated) throw new Error('report-refresh regenerated with an impossible threshold; check the endpoint logic');
    return { baseUrl: cfg.baseUrl, health, signedCallOk: true };
  },
);
