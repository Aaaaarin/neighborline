import { NextResponse } from 'next/server';
import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { isSecure } from '@/lib/server/passkeys/schemas';
import { readSessionFromRequest, sessionCookieHeader } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

const Input = z.object({ credentialId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(1024) });

/** Revoke a passkey (lost phone). Needs a signed-in organizer; revoking your own device signs you out. */
export const POST = route(async (req: Request) => {
  const { credentialId } = await body(req, Input);
  const out = await services().revokePasskey({ credentialId, session: readSessionFromRequest(req) });
  const res = NextResponse.json(out);
  if (out.signedOut) res.headers.append('set-cookie', sessionCookieHeader(null, isSecure(req)));
  return res;
});
