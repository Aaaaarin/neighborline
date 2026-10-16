import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Reason = z.enum(['outside_area', 'household_cap', 'needs_info', 'not_covered', 'other']);
const Input = z.object({ organizerId: z.string().min(1), reasonCode: Reason, note: z.string().trim().max(400).optional() });

/** Extension to SPEC §5: decline with a reason the neighbor receives in their language, plus an appeal path. */
export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  return services().decline({ requestId: id, ...(await body(req, Input)) });
});
