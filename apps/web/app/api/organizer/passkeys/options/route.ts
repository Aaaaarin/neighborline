import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { originOf } from '@/lib/server/passkeys/schemas';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

const Input = z.object({ organizerId: z.string().min(1), inviteCode: z.string().max(40).optional() });

/** Start enrolling a passkey for an organizer (invite code needed unless DEMO_MODE or already signed in as them). */
export const POST = route(async (req: Request) =>
  services().passkeyRegistrationOptions({ ...(await body(req, Input)), origin: originOf(req), session: readSessionFromRequest(req) }),
);
