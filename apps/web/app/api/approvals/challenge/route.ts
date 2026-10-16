import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { originOf } from '@/lib/server/passkeys/schemas';
import { limit } from '@/lib/server/security/access';
import { viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

const Input = z.object({
  requestIds: z.array(z.string().min(1)).min(1).max(50),
  organizerId: z.string().min(1).optional(),
  credentialIds: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).max(10).optional(),
});

/**
 * WebAuthn request options for one Approve tap. The challenge is challengeFor(approval hash, server
 * nonce): it commits to exactly what will be paid, and the single-use nonce (5 min) is stored with the
 * assertion so the approver can re-verify it.
 */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  limit(req, 'approve', await viewerOf(req));
  return services().approvalChallenge({ ...input, origin: originOf(req) });
});
