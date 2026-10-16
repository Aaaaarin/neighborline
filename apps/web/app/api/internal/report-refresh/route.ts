import { internalRoute } from '@/lib/server/internal-route';
import { ReportRefreshBody } from '@/lib/server/internal-schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Regenerate the donor report when enough new payouts happened (or force). Contract: workflows/src/contract.ts. */
export const POST = internalRoute(ReportRefreshBody, (ops, input) => ops.reportRefresh(input));
