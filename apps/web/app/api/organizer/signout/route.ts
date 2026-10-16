import { NextResponse } from 'next/server';
import { route } from '@/lib/server/http';
import { isSecure } from '@/lib/server/passkeys/schemas';
import { sessionCookieHeader } from '@/lib/server/passkeys/session';

export const POST = route(async (req: Request) => {
  const res = NextResponse.json({ ok: true });
  res.headers.append('set-cookie', sessionCookieHeader(null, isSecure(req)));
  return res;
});
