import { RequestStatus } from '@neighborline/core';
import { route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/** GET /api/requests?status=awaiting_approval,paying */
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get('status');
  const status = raw
    ?.split(',')
    .map((s) => RequestStatus.safeParse(s.trim()))
    .filter((r) => r.success)
    .map((r) => r.data);
  return services().listRequests({ status });
});
