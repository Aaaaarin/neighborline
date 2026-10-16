import { internalRoute } from '@/lib/server/internal-route';
import { ReconcileBody } from '@/lib/server/internal-schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Compare local payout items with PayPal Transaction Search for one window. Contract: workflows/src/contract.ts. */
export const POST = internalRoute(ReconcileBody, (ops, input) => ops.reconcileWindow(input));
