import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({ confirmed: z.boolean(), corrections: z.string().trim().max(2000).optional() });

export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  return services().confirmIntake(id, await body(req, Input));
});
