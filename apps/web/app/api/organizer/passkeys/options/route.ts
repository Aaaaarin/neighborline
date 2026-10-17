import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { originOf } from '@/lib/server/passkeys/schemas';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { enforceLimit } from '@/lib/server/security/rate-limit';
import { ensureVisitor, jsonWithVisitor } from '@/lib/server/security/visitor';
import { services } from '@/lib/server/services';

const Input = z.object({ organizerId: z.string().min(1), inviteCode: z.string().max(40).optional(), demoVisitor: z.boolean().optional() });

/**
 * Start enrolling a passkey for an organizer: an invite code is needed (demo or not) unless already
 * signed in as them. `demoVisitor: true` (DEMO_MODE only, Marcus only) enrolls the visitor's own device
 * as a demo-visitor passkey bound to this browser's visitor id: it signs only this visitor's demo runs.
 */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  const visitor = ensureVisitor(req);
  await enforceLimit(req, 'passkey', { visitorTag: visitor.tag });
  const { demoVisitor, ...rest } = input;
  const out = await services().passkeyRegistrationOptions({ ...rest, origin: originOf(req), session: readSessionFromRequest(req), ...(demoVisitor ? { demoVisitorTag: visitor.tag } : {}) });
  return jsonWithVisitor(out, visitor, req);
});
