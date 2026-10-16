import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({ itemId: z.string().min(1) });

export const POST = route(async (req: Request, { params }: Params<'batchId'>) => {
  const { batchId } = await params;
  const { itemId } = await body(req, Input);
  return services().cancelPayoutItem({ batchId, itemId });
});
