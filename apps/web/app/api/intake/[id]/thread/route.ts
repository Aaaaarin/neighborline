import { HttpError } from '@/lib/server/errors';
import { route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/** Extension to SPEC §5: the neighbor's message thread (read-back, status, callbacks). */
export const GET = route(async (_req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const thread = await services().getThread(id);
  if (!thread) throw new HttpError(404, 'No such request');
  return thread;
});
