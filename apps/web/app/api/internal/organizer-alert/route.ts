import { internalRoute } from '@/lib/server/internal-route';
import { OrganizerAlertBody } from '@/lib/server/internal-schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Record one organizer alert per idempotencyKey (audit log); shown on /organizer and /ledger. Contract: workflows/src/contract.ts. */
export const POST = internalRoute(OrganizerAlertBody, (ops, input) => ops.organizerAlert(input));
