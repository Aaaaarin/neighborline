import { route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const POST = route(async (_req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  return services().captureDonationOrder(id);
});
