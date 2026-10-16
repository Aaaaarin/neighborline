import { route } from '@/lib/server/http';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/** Who is signed in on this browser (if their passkey still exists) + which organizers have passkeys (labels only). */
export const GET = route(async (req: Request) => {
  const svc = services();
  return { session: await svc.liveSession(readSessionFromRequest(req)), roster: await svc.passkeyRoster() };
});
