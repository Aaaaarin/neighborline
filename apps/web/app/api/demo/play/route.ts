import { z } from 'zod';
import { HttpError } from '@/lib/server/errors';
import { body, route } from '@/lib/server/http';
import { demoModeOn } from '@/lib/server/passkeys/demo-signer';
import { enforceLimit } from '@/lib/server/security/rate-limit';
import { ensureVisitor, jsonWithVisitor } from '@/lib/server/security/visitor';
import { services } from '@/lib/server/services';

const Input = z.object({
  scenario: z.enum(['lan', 'rosa', 'jean', 'walter', 'blocked']),
  mode: z.enum(['auto', 'manual']).default('auto'),
  speed: z.number().min(0.25).max(20).optional(),
});

/**
 * Extension to SPEC §5 (demo only): run a scripted scenario through the real code path. The run is
 * tagged with the caller's visitor id (req_demo_<tag>_…): only this browser sees it in full, other
 * visitors never see it, and it never counts against a real household's caps. Not rate-exempt from
 * abuse limits, but exempt from the group's money caps.
 */
export const POST = route(async (req: Request) => {
  if (!demoModeOn(process.env)) throw new HttpError(403, 'Demo controls are off (DEMO_MODE is off).');
  const input = await body(req, Input);
  const visitor = ensureVisitor(req);
  enforceLimit(req, 'demo', { visitorTag: visitor.tag });
  const run = await services().playScenario({ ...input, visitorTag: visitor.tag });
  return jsonWithVisitor(run, visitor, req);
});
