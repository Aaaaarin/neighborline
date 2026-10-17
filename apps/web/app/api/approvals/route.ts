import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { AssertionJSON, originOf } from '@/lib/server/passkeys/schemas';
import { assertPublicDemoKey, limit } from '@/lib/server/security/access';
import { viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

const Input = z.object({
  requestIds: z.array(z.string().min(1)).min(1).max(50),
  organizerId: z.string().min(1).optional(),
  signer: z.discriminatedUnion('kind', [z.object({ kind: z.literal('passkey'), assertion: AssertionJSON }), z.object({ kind: z.literal('demo_key') })]),
});

/**
 * One signed Approve tap. The WebAuthn assertion's challenge must be challengeFor(approval hash,
 * server nonce) for the requests as they are now; the approver is whoever owns the credential.
 * `demo_key` from a browser works only in DEMO_MODE, only as Marcus and only on the caller's own runs
 * (security/access.ts). Two distinct signed approvers → the batch executes. Concurrent taps are
 * idempotent: they all get 200 and the same batch.
 */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  const viewer = await viewerOf(req);
  await limit(req, 'approve', viewer);
  const origin = originOf(req);
  if (input.signer.kind === 'demo_key') {
    if (!input.organizerId) return Response.json({ error: 'organizerId is required with a demo key' }, { status: 400 });
    assertPublicDemoKey(viewer, input.organizerId, input.requestIds);
    return services().approve({ requestIds: input.requestIds, organizerId: input.organizerId, signer: { kind: 'demo_key' }, origin });
  }
  return services().approve({ requestIds: input.requestIds, signer: { kind: 'passkey', assertion: input.signer.assertion }, ...(input.organizerId ? { organizerId: input.organizerId } : {}), origin });
});
