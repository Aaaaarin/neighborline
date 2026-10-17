import { Channel, Lang } from '@neighborline/core';
import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { limitIntake } from '@/lib/server/security/access';
import { ensureVisitor, jsonWithVisitor, visitorRequestId } from '@/lib/server/security/visitor';
import { services } from '@/lib/server/services';

const Input = z.object({ groupSlug: z.string().min(1).max(64), channel: Channel, lang: Lang.optional() });

/** The request id carries the caller's visitor tag (req_v_<tag>_…): only this browser can continue it. */
export const POST = route(async (req: Request) => {
  const input = await body(req, Input);
  const visitor = ensureVisitor(req);
  await limitIntake(req, { organizer: null, visitor, demo: false }, { ai: false });
  const out = await services().startIntake({ ...input, id: visitorRequestId(visitor.tag) });
  return jsonWithVisitor(out, visitor, req);
});
