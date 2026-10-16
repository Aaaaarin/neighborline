import { NextResponse } from 'next/server';
import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { AssertionJSON, isSecure } from '@/lib/server/passkeys/schemas';
import { encodeSession, sessionCookieHeader } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

/** Sign in with a passkey (discoverable credential) → HttpOnly session cookie. */
export const POST = route(async (req: Request) => {
  const { response } = await body(req, z.object({ response: AssertionJSON }));
  const session = await services().passkeySignIn({ response });
  const res = NextResponse.json({ session });
  res.headers.append('set-cookie', sessionCookieHeader(encodeSession(session), isSecure(req)));
  return res;
});
