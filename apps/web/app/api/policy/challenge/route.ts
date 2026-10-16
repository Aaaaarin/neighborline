import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { originOf } from '@/lib/server/passkeys/schemas';
import { services } from '@/lib/server/services';

const Input = z.object({ draftHash: z.string().regex(/^[0-9a-f]{64}$/), organizerId: z.string().min(1).optional() });

/** WebAuthn request options whose challenge is the policy draft hash (the 32 bytes, base64url). */
export const POST = route(async (req: Request) => services().policyChallenge({ ...(await body(req, Input)), origin: originOf(req) }));
