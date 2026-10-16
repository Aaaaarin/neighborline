import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({ subscriptionId: z.string().min(1).max(64), amountCents: z.number().int().min(100).max(100_000) });

export const POST = route(async (req: Request) => services().recordSubscription(await body(req, Input)));
