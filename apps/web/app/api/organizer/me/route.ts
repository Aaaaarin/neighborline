import { route } from '@/lib/server/http';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/** Who is signed in on this browser (if anyone) + which organizers have passkeys (labels only). */
export const GET = route(async (req: Request) => ({ session: readSessionFromRequest(req), roster: await services().passkeyRoster() }));
