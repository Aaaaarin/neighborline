import { clipStore } from '@/lib/server/voice/clips';
import { readPhoneConfig } from '@/lib/server/voice/config';

/**
 * Short-lived TTS clips Twilio <Play>s for languages it has no voice for (lib/server/voice/clips.ts).
 * The token is signed and expires (10 min in-call, 30 min for call-backs); the audio lives in memory only.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const cfg = readPhoneConfig();
  if (!cfg.enabled) return new Response('Not found', { status: 404 });
  const { token } = await params;
  const clip = clipStore(cfg.authToken).get(token);
  if (!clip) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(clip.audio), {
    headers: { 'content-type': clip.mimeType, 'cache-control': 'private, no-store', 'content-length': String(clip.audio.byteLength) },
  });
}
