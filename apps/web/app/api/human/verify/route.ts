import { z } from 'zod';
import { HttpError } from '@/lib/server/errors';
import { body, route } from '@/lib/server/http';
import { limit, siteHumanCheck } from '@/lib/server/security/access';
import { PASS_TTL_MS, passCookieHeader, passValue } from '@/lib/server/security/human-check';
import { clientIp } from '@/lib/server/security/rate-limit';
import { visitorFromRequest } from '@/lib/server/security/visitor';

const Proof = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pow'), challenge: z.string().min(1).max(300), solution: z.array(z.number().int().min(0).max(0xffffffff)).min(1).max(64) }),
  z.object({ kind: z.literal('turnstile'), token: z.string().min(1).max(2048) }),
]);

/** Check a proof for this browser's visitor id and, if it holds, set the 30-minute human pass cookie. */
export const POST = route(async (req: Request) => {
  const proof = await body(req, Proof);
  const visitor = visitorFromRequest(req);
  if (!visitor) throw new HttpError(400, 'Ask for a challenge first.');
  await limit(req, 'human', { organizer: null, visitor, demo: false });
  const check = siteHumanCheck();
  if (check.mode === 'off') return { ok: true, expiresAt: null };
  await check.verify(visitor, proof, { ip: clientIp(req) });
  const res = Response.json({ ok: true, expiresAt: new Date(Date.now() + PASS_TTL_MS).toISOString() });
  res.headers.append('set-cookie', passCookieHeader(passValue(visitor, check.mode), (req.headers.get('origin') ?? req.url).startsWith('https:')));
  return res;
});
