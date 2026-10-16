import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({
  reasonCode: z.enum(['outside_area', 'household_cap', 'needs_info', 'not_covered', 'other']),
  note: z.string().trim().max(400).optional(),
});

export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  return services().previewDecline({ requestId: id, ...(await body(req, Input)) });
});
