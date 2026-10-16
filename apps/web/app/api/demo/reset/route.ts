import { HttpError } from '@/lib/server/errors';
import { route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

export const POST = route(async () => {
  if (process.env.DEMO_MODE === 'false') throw new HttpError(403, 'Demo controls are off (DEMO_MODE=false).');
  await services().resetDemo();
  return { ok: true };
});
