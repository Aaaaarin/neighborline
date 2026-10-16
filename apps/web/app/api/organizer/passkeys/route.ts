import { NextResponse } from 'next/server';
import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { RegistrationJSON, isSecure, originOf } from '@/lib/server/passkeys/schemas';
import { encodeSession, readSessionFromRequest, sessionCookieHeader } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

const Input = z.object({
  organizerId: z.string().min(1),
  inviteCode: z.string().max(40).optional(),
  deviceLabel: z.string().max(60).default(''),
  response: RegistrationJSON,
});

/** Finish enrolling: verify the attestation, store the public key, sign the organizer in. */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  const session = await services().passkeyRegister({ ...input, origin: originOf(req), session: readSessionFromRequest(req) });
  const res = NextResponse.json({ session });
  res.headers.append('set-cookie', sessionCookieHeader(encodeSession(session), isSecure(req)));
  return res;
});
