import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { AssertionJSON, originOf } from '@/lib/server/passkeys/schemas';
import { services } from '@/lib/server/services';

const Input = z.object({
  requestIds: z.array(z.string().min(1)).min(1).max(50),
  organizerId: z.string().min(1).optional(),
  signer: z.discriminatedUnion('kind', [z.object({ kind: z.literal('passkey'), assertion: AssertionJSON }), z.object({ kind: z.literal('demo_key') })]),
});

/**
 * One signed Approve tap. The WebAuthn assertion's challenge must be the approval hash of the
 * requests as they are now; the approver is whoever owns the credential. `demo_key` works only in
 * DEMO_MODE and is labelled as such everywhere. Two distinct signed approvers → the batch executes.
 */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  const origin = originOf(req);
  if (input.signer.kind === 'demo_key') {
    if (!input.organizerId) return Response.json({ error: 'organizerId is required with a demo key' }, { status: 400 });
    return services().approve({ requestIds: input.requestIds, organizerId: input.organizerId, signer: { kind: 'demo_key' }, origin });
  }
  return services().approve({ requestIds: input.requestIds, signer: { kind: 'passkey', assertion: input.signer.assertion }, ...(input.organizerId ? { organizerId: input.organizerId } : {}), origin });
});
