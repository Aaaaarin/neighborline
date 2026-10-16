import { route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/** The active rules, the open (or just activated) draft with its signatures, and the version history. */
export const GET = route(async () => services().policyEditor());
