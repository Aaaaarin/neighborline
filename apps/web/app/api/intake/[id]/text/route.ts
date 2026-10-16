import { Lang } from '@neighborline/core';
import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({ text: z.string().trim().min(1).max(2000), lang: Lang.optional() });

export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  return services().submitText(id, await body(req, Input));
});
