import { handleVoice } from '@/lib/server/voice/call-flow';
import { voiceDeps } from '@/lib/server/voice/deps';

/**
 * Twilio Voice webhooks: POST /api/voice/incoming (the number's "A call comes in" URL), then the action
 * and callback URLs the line's own TwiML points at (recorded, recording-status, wait, confirm, payout,
 * menu). Every request must carry a valid X-Twilio-Signature (lib/server/voice/signature.ts); 404 when
 * TWILIO_* is not configured. See docs/PHONE.md.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  return handleVoice(step, req, voiceDeps());
}
