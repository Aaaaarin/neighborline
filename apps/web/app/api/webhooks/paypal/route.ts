import { NextResponse } from 'next/server';
import { route } from '@/lib/server/http';
import { readCapped } from '@/lib/server/security/guard';
import { services } from '@/lib/server/services';

/** PayPal webhooks. The body is read raw so the signature can be verified over the exact bytes. */
export const POST = route(async (req: Request) => {
  const rawBody = await readCapped(req, 256 * 1024);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const result = await services().handlePaypalWebhook({ headers, rawBody });
  return NextResponse.json(result, { status: result.verified ? 200 : 400 });
});
