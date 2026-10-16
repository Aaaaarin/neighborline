import { HttpError } from '@/lib/server/errors';
import { route, type Params } from '@/lib/server/http';
import { viewFor } from '@/lib/server/security/redact';
import { viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/** One request, scoped to the viewer like GET /api/requests (another visitor's demo run is a 404). */
export const GET = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const view = viewFor(await viewerOf(req), await services().getRequest(id));
  if (!view) throw new HttpError(404, 'No such request');
  return view;
});
