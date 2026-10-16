import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { originOf } from '@/lib/server/passkeys/schemas';
import { services } from '@/lib/server/services';

const Input = z.object({
  requestIds: z.array(z.string().min(1)).min(1).max(50),
  organizerId: z.string().min(1).optional(),
  credentialIds: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).max(10).optional(),
});

/** WebAuthn request options whose challenge is the approval hash (the 32 bytes, base64url). */
export const POST = route(async (req: Request) => services().approvalChallenge({ ...(await body(req, Input)), origin: originOf(req) }));
