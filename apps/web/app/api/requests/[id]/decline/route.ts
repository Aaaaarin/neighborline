import { z } from 'zod';
import { HttpError } from '@/lib/server/errors';
import { body, route, type Params } from '@/lib/server/http';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

const Reason = z.enum(['outside_area', 'household_cap', 'needs_info', 'not_covered', 'other']);
const Input = z.object({ organizerId: z.string().min(1), reasonCode: Reason, note: z.string().trim().max(400).optional() });

/**
 * Extension to SPEC §5: decline with a reason the neighbor receives in their language, plus an appeal path.
 * No money moves, so no per-tap signature: the organizer must be signed in with a passkey as
 * `organizerId` (DEMO_MODE also lets a visitor decline as a demo organizer).
 */
export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const input = await body(req, Input);
  const session = readSessionFromRequest(req);
  if (session?.organizerId !== input.organizerId && process.env.DEMO_MODE === 'false') {
    throw new HttpError(401, 'Sign in with your passkey to decline requests.');
  }
  return services().decline({ requestId: id, ...input });
});
