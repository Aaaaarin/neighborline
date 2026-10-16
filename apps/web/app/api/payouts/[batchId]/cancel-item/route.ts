import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { payoutActorOf, viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

const Input = z.object({ itemId: z.string().min(1) });

/**
 * Cancel an UNCLAIMED payout (the money returns to the fund). A signed-in organizer, or in DEMO_MODE
 * the visitor whose own demo run it pays; the engine checks that ownership on the item itself.
 */
export const POST = route(async (req: Request, { params }: Params<'batchId'>) => {
  const { batchId } = await params;
  const { itemId } = await body(req, Input);
  const actor = payoutActorOf(await viewerOf(req));
  return services().cancelPayoutItem({ batchId, itemId, actor });
});
