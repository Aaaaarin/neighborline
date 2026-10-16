import { HttpError } from '@/lib/server/errors';
import { route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const view = await services().getRequest(id);
  if (!view) throw new HttpError(404, 'No such request');
  return view;
});
