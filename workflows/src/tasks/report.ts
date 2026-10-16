/**
 * Donor transparency report regeneration. The app decides whether it is due (N+ new payouts since the
 * last version) and runs the ReportWriter agent; this task gives it retries, a timeout and a run history.
 *
 * Triggered by the cron dispatcher every hour (reason 'schedule') and, optionally, by the app itself
 * right after the Nth payout SUCCESS webhook (reason 'payout_threshold') via the Render API.
 */
import { task, type TaskContext } from '@renderinc/sdk/workflows';
import { ENDPOINTS, type ReportRefreshRequest, type ReportRefreshResponse } from '../contract.js';
import { connect, log } from './shared.js';

export const refreshReport = task(
  {
    name: 'refreshReport',
    // LLM narrative + Transaction Search inflows can be slow or rate limited.
    retry: { maxRetries: 3, waitDurationMs: 20_000, backoffScaling: 2 },
    timeoutSeconds: 600,
  },
  async function refreshReport(_ctx: TaskContext, req: Partial<ReportRefreshRequest> = {}): Promise<ReportRefreshResponse> {
    const { cfg, api } = connect();
    const body: ReportRefreshRequest = {
      minNewPayouts: req.minNewPayouts ?? cfg.reportEveryNPayouts,
      force: req.force ?? false,
      reason: req.reason ?? 'manual',
    };
    const res = await api.post<ReportRefreshRequest, ReportRefreshResponse>(ENDPOINTS.reportRefresh, body);
    log('report_refresh', { ...body, regenerated: res.regenerated, newPayouts: res.newPayoutsSinceLast, version: res.reportVersion });
    return res;
  },
);
