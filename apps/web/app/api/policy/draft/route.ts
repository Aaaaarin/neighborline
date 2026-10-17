import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { limit, siteHumanCheck } from '@/lib/server/security/access';
import { requireHuman } from '@/lib/server/security/human-check';
import { viewerOf } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

const Input = z.object({ sourceText: z.string().min(1).max(8000) });

/**
 * Plain-English rules → agents.policy.compile → a stored draft (diff, quotes, queue preview).
 * Drafting changes nothing: two organizers must sign the draft hash to activate it.
 */
export const POST = route(async (req: Request) => {
  const { sourceText } = await body(req, Input);
  const viewer = await viewerOf(req);
  // A draft is one model call: anonymous drafters (the public demo) need a human pass like intake.
  requireHuman(req, viewer, siteHumanCheck());
  if (services().modes.aiMode === 'live') await limit(req, 'ai', viewer);
  return services().compilePolicy({ sourceText, session: readSessionFromRequest(req) });
});
