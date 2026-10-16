import { z } from 'zod';
import { HttpError } from '@/lib/server/errors';
import { body, route, type Params } from '@/lib/server/http';
import { ownsAll, viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

const Reason = z.enum(['outside_area', 'household_cap', 'needs_info', 'not_covered', 'other']);
const Input = z.object({ organizerId: z.string().min(1), reasonCode: Reason, note: z.string().trim().max(400).optional() });

/**
 * Extension to SPEC §5: decline with a reason the neighbor receives in their language, plus an appeal path.
 * No money moves, so no per-tap signature: the organizer must be signed in with a live passkey as
 * `organizerId`. In DEMO_MODE a visitor may also decline their OWN runs (any demo organizer), never the
 * shared queue or another visitor's requests.
 */
export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const input = await body(req, Input);
  const viewer = await viewerOf(req);
  const asOrganizer = viewer.organizer?.organizerId === input.organizerId;
  if (!asOrganizer && !(viewer.demo && ownsAll(viewer, [id]))) {
    throw new HttpError(viewer.organizer ? 403 : 401, viewer.organizer ? 'You can decline only as yourself.' : 'Sign in with your passkey to decline requests.');
  }
  return services().decline({ requestId: id, ...input });
});
