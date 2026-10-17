import { route } from '@/lib/server/http';
import { limit, siteHumanCheck } from '@/lib/server/security/access';
import { passExpiry } from '@/lib/server/security/human-check';
import { ensureVisitor, jsonWithVisitor } from '@/lib/server/security/visitor';

/**
 * What this browser must do before model-using intake: nothing (fixture mode, or a valid pass), a
 * proof of work, or Cloudflare Turnstile. Mints the visitor cookie the challenge is bound to.
 */
export const POST = route(async (req: Request) => {
  const visitor = ensureVisitor(req);
  await limit(req, 'human', { organizer: null, visitor, demo: false });
  const check = siteHumanCheck();
  const exp = check.mode === 'off' || visitor.fresh ? null : passExpiry(req, visitor);
  return jsonWithVisitor(exp ? { kind: 'passed', expiresAt: new Date(exp).toISOString() } : check.challenge(visitor), visitor, req);
});
