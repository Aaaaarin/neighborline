import { HttpError } from '@/lib/server/errors';
import { route, type Params } from '@/lib/server/http';
import { requireRequester } from '@/lib/server/security/access';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/**
 * Extension to SPEC §5: the neighbor's message thread (read-back, status, callbacks). Private to the
 * visitor who started the request (and organizers); anyone else gets 404.
 */
export const GET = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  await requireRequester(req, id);
  const thread = await services().getThread(id);
  if (!thread) throw new HttpError(404, 'No such request');
  return thread;
});
