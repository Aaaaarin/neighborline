import { z } from 'zod';
import { body, route } from '@/lib/server/http';
import { readSessionFromRequest } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

const Input = z.object({ manualFallback: z.boolean() }).strict();

/** The group's payout rails: PayPal Payouts, and whether to fall back to manual recording. */
export const GET = route(async () => services().railSettings());

/**
 * "If PayPal is unavailable or the account is restricted, switch to manual recording." A signed-in
 * organizer only (live passkey session); every change is a row in the audit log.
 */
export const POST = route(async (req: Request) => {
  const { manualFallback } = await body(req, Input);
  return services().setManualFallback({ enabled: manualFallback, session: readSessionFromRequest(req) });
});
