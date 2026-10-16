import { route } from '@/lib/server/http';
import { originOf } from '@/lib/server/passkeys/schemas';
import { services } from '@/lib/server/services';

export const POST = route(async (req: Request) => services().passkeySignInOptions({ origin: originOf(req) }));
