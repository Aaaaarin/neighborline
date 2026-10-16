import { RequestStatus } from '@neighborline/core';
import { route } from '@/lib/server/http';
import { viewsFor } from '@/lib/server/security/redact';
import { viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/**
 * GET /api/requests?status=awaiting_approval,paying — the organizer queue. Full for a signed-in
 * organizer; for anyone else redacted (first name + area, masked destination, no transcript), with the
 * caller's own runs in full and, in DEMO_MODE, other visitors' runs left out (security/redact.ts).
 */
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get('status');
  const status = raw
    ?.split(',')
    .map((s) => RequestStatus.safeParse(s.trim()))
    .filter((r) => r.success)
    .map((r) => r.data);
  const [viewer, views] = await Promise.all([viewerOf(req), services().listRequests({ status })]);
  return viewsFor(viewer, views);
});
