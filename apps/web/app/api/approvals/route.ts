import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({
  requestIds: z.array(z.string().min(1)).min(1).max(50),
  organizerId: z.string().min(1),
  deviceLabel: z.string().min(1).max(80),
});

/** Records one approver; when two distinct organizers have approved, the approval service executes the batch. */
export const POST = route(async (req: Request) => services().approve(await body(req, Input)));
