import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({ amountCents: z.number().int().min(100).max(100_000) });

/** Returns the PayPal billing plan id for a monthly amount (null → simulated). */
export const POST = route(async (req: Request) => services().getSubscriptionPlan(await body(req, Input)));
