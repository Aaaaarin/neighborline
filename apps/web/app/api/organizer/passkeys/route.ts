import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HttpError } from '@/lib/server/errors';
import { body, route } from '@/lib/server/http';
import { RegistrationJSON, isSecure, originOf } from '@/lib/server/passkeys/schemas';
import { encodeSession, readSessionFromRequest, sessionCookieHeader } from '@/lib/server/passkeys/session';
import { enforceLimit } from '@/lib/server/security/rate-limit';
import { visitorFromRequest } from '@/lib/server/security/visitor';
import { services } from '@/lib/server/services';

const Input = z.object({
  organizerId: z.string().min(1),
  inviteCode: z.string().max(40).optional(),
  deviceLabel: z.string().max(60).default(''),
  demoVisitor: z.boolean().optional(),
  response: RegistrationJSON,
});

/**
 * Finish enrolling: verify the attestation, store the public key, sign the organizer in. A
 * demo-visitor passkey gets NO organizer session cookie: it is not an organizer login, only a signer
 * for this visitor's own /demo runs.
 */
export const POST = route(async (req: Request) => {
  const { demoVisitor, ...input } = await body(req, Input);
  const visitor = visitorFromRequest(req);
  await enforceLimit(req, 'passkey', { visitorTag: visitor?.tag ?? null });
  if (demoVisitor && !visitor) throw new HttpError(400, 'Open /demo again: this browser has no demo session yet.');
  const session = await services().passkeyRegister({ ...input, origin: originOf(req), session: readSessionFromRequest(req), ...(demoVisitor && visitor ? { demoVisitorTag: visitor.tag } : {}) });
  const res = NextResponse.json({ session });
  if (!demoVisitor) res.headers.append('set-cookie', sessionCookieHeader(encodeSession(session), isSecure(req)));
  return res;
});
