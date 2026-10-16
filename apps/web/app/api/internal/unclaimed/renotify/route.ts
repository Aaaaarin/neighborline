import { internalRoute } from '@/lib/server/internal-route';
import { RenotifyBody } from '@/lib/server/internal-schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One claim-help follow-up in the neighbor's language, deduped on idempotencyKey. Contract: workflows/src/contract.ts. */
export const POST = internalRoute(RenotifyBody, (ops, input) => ops.renotify(input));
