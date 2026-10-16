import { task, type TaskContext } from '@renderinc/sdk/workflows';
import { ENDPOINTS, type OrganizerAlertRequest, type OrganizerAlertResponse } from '../contract.js';
import { connect, log } from './shared.js';

/**
 * Tell the group's organizers that something needs a human (unclaimed day-25, reconcile mismatch).
 * Shared by the reconcile and unclaimed workflows. Safe to retry: the app dedupes on idempotencyKey.
 */
export const alertOrganizers = task(
  {
    name: 'alertOrganizers',
    retry: { maxRetries: 4, waitDurationMs: 15_000, backoffScaling: 2 },
    timeoutSeconds: 300,
  },
  async function alertOrganizers(_ctx: TaskContext, alert: OrganizerAlertRequest): Promise<OrganizerAlertResponse> {
    const { api } = connect();
    const res = await api.post<OrganizerAlertRequest, OrganizerAlertResponse>(ENDPOINTS.organizerAlert, alert);
    log('organizer_alert', { kind: alert.kind, key: alert.idempotencyKey, items: alert.itemIds.length, created: res.created });
    return res;
  },
);
