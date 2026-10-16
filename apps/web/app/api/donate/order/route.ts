import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { enforceLimit } from '@/lib/server/security/rate-limit';
import { services } from '@/lib/server/services';

const Input = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
  source: z.enum(['PAYPAL', 'VENMO', 'PAYLATER', 'CARD']).default('PAYPAL'),
});

/** Create an Orders v2 order on the server (amount is never trusted from the button alone). */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  enforceLimit(req, 'donate');
  return services().createDonationOrder(input);
});
