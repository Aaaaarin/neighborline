import { internalRoute } from '@/lib/server/internal-route';
import { UnclaimedSweepBody } from '@/lib/server/internal-schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Read-only list of UNCLAIMED payout items (the workflow decides what is due). Contract: workflows/src/contract.ts. */
export const POST = internalRoute(UnclaimedSweepBody, (ops, input) => ops.unclaimedSweep(input));
