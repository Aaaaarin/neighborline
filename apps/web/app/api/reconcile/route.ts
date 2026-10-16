import { route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const POST = route(async () => services().reconcile());
