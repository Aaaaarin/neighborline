import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { limitIntake, requireRequester } from '@/lib/server/security/access';
import { services } from '@/lib/server/services';

const Input = z.object({ confirmed: z.boolean(), corrections: z.string().trim().max(2000).optional() });

export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const input = await body(req, Input);
  const viewer = await requireRequester(req, id);
  // A correction is re-extracted by the model; a plain "yes" costs no AI.
  await limitIntake(req, viewer, input.corrections ? {} : { ai: false });
  return services().confirmIntake(id, input);
});
