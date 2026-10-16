import { route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const dynamic = 'force-dynamic';
export const GET = route(async () => services().getLedger());
