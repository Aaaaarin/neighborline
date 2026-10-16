import { z } from 'zod';
import { body, route, type Params } from '@/lib/server/http';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

const Input = z.object({ method: z.enum(['cash', 'check', 'other']), receiptNote: z.string().trim().min(8).max(500) }).strict();

/**
 * Manual rail: a signed-in organizer records how a payout PayPal refused at the account level was handed
 * over (cash, a sponsor check, other). The approver re-verifies the approval's two passkey signatures and
 * the group's fallback setting before it records; nothing here or there moves money.
 */
export const POST = route(async (req: Request, { params }: Params<'batchId'>) => {
  const { batchId } = await params;
  const input = await body(req, Input);
  return services().recordManualPayout({ batchId, ...input, session: readSessionFromRequest(req) });
});
