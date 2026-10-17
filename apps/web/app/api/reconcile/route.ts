import { HttpError } from '@/lib/server/errors';
import { route } from '@/lib/server/http';
import { limit } from '@/lib/server/security/access';
import { viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

/**
 * Reconcile against PayPal Transaction Search now (also nightly via /api/internal/reconcile). Each run
 * is persisted (reconcile_runs) and shown on /ledger, including status drift. Calls PayPal, so with a
 * real PayPal environment it needs a signed-in organizer; against the local fake PayPal anyone may
 * press the button (rate-limited).
 */
export const POST = route(async (req: Request) => {
  const viewer = await viewerOf(req);
  if (services().modes.paypalMode !== 'fake' && !viewer.organizer) throw new HttpError(401, 'Sign in as an organizer to reconcile with PayPal.');
  await limit(req, 'reconcile', viewer);
  return services().reconcile();
});
