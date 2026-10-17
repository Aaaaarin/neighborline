import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { limit } from '@/lib/server/security/access';
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
  if (services().modes.aiMode === 'live') await limit(req, 'ai', viewer);
  return services().compilePolicy({ sourceText, session: readSessionFromRequest(req) });
});
