import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { AssertionJSON, originOf } from '@/lib/server/passkeys/schemas';
import { services } from '@/lib/server/services';

const Input = z.object({
  draftHash: z.string().regex(/^[0-9a-f]{64}$/),
  organizerId: z.string().min(1).optional(),
  signer: z.discriminatedUnion('kind', [z.object({ kind: z.literal('passkey'), assertion: AssertionJSON }), z.object({ kind: z.literal('demo_key') })]),
});

/**
 * One organizer signs a policy draft. The signer is whoever owns the credential; `demo_key` works only
 * in DEMO_MODE and is labelled. The second distinct valid signature activates the new version.
 */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  const origin = originOf(req);
  if (input.signer.kind === 'demo_key') {
    if (!input.organizerId) return Response.json({ error: 'organizerId is required with a demo key' }, { status: 400 });
    return services().signPolicy({ draftHash: input.draftHash, organizerId: input.organizerId, signer: { kind: 'demo_key' }, origin });
  }
  return services().signPolicy({ draftHash: input.draftHash, signer: { kind: 'passkey', assertion: input.signer.assertion }, ...(input.organizerId ? { organizerId: input.organizerId } : {}), origin });
});
