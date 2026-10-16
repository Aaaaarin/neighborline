import { Channel, Lang } from '@neighborline/core';
import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

const Input = z.object({ groupSlug: z.string().min(1).max(64), channel: Channel, lang: Lang.optional() });

export const POST = route(async (req: Request) => services().startIntake(await body(req, Input)));
