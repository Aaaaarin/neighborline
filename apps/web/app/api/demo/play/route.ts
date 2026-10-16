import { z } from 'zod';
import { HttpError } from '@/lib/server/errors';
import { body, route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({
  scenario: z.enum(['lan', 'rosa', 'jean', 'walter', 'blocked']),
  mode: z.enum(['auto', 'manual']).default('auto'),
  speed: z.number().min(0.25).max(20).optional(),
});

/** Extension to SPEC §5 (demo only): run a scripted scenario through the real code path. */
export const POST = route(async (req: Request) => {
  if (process.env.DEMO_MODE === 'false') throw new HttpError(403, 'Demo controls are off (DEMO_MODE=false).');
  return services().playScenario(await body(req, Input));
});
