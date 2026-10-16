import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { AssertionJSON, originOf } from '@/lib/server/passkeys/schemas';
import { HttpError } from '@/lib/server/errors';
import { DEMO_SEAT } from '@/lib/server/passkeys/demo-signer';
import { services } from '@/lib/server/services';

const Input = z.object({
  draftHash: z.string().regex(/^[0-9a-f]{64}$/),
  organizerId: z.string().min(1).optional(),
  signer: z.discriminatedUnion('kind', [z.object({ kind: z.literal('passkey'), assertion: AssertionJSON }), z.object({ kind: z.literal('demo_key') })]),
});

/**
 * One organizer signs a policy draft. The signer is whoever owns the credential; `demo_key` works only
 * in DEMO_MODE, only as Marcus (the seat a visitor plays), and is labelled. So a new policy always needs
 * at least one real organizer's passkey (invite-gated): one visitor alone can never change the rules.
 * The second distinct valid signature activates the new version.
 */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  const origin = originOf(req);
  if (input.signer.kind === 'demo_key') {
    if (!input.organizerId) return Response.json({ error: 'organizerId is required with a demo key' }, { status: 400 });
    if (input.organizerId !== DEMO_SEAT) throw new HttpError(403, 'In this demo the demo key signs as Marcus only; the other signature must be an organizer’s passkey.');
    return services().signPolicy({ draftHash: input.draftHash, organizerId: input.organizerId, signer: { kind: 'demo_key' }, origin });
  }
  return services().signPolicy({ draftHash: input.draftHash, signer: { kind: 'passkey', assertion: input.signer.assertion }, ...(input.organizerId ? { organizerId: input.organizerId } : {}), origin });
});
