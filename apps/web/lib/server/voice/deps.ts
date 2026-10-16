/**
 * Production wiring for the /api/voice/* routes: config from env, the engine's phone entry point, the
 * real Twilio REST client, and the process-wide clip/job/call stores and rate limiter.
 */
import 'server-only';
import { HttpError } from '../errors';
import { limiter } from '../security/rate-limit';
import { services } from '../services';
import type { VoiceDeps } from './call-flow';
import { voiceState } from './calls';
import { clipStore } from './clips';
import { readPhoneConfig } from './config';
import { createTwilioApi } from './twilio-api';

export function voiceDeps(env: Record<string, string | undefined> = process.env): VoiceDeps {
  const cfg = readPhoneConfig(env);
  const { jobs, calls } = voiceState();
  return {
    cfg,
    env,
    phone: async () => {
      const s = services();
      if (!s.phone) throw new HttpError(501, 'The phone line needs the real engine (ENGINE is set to mock).');
      return s.phone();
    },
    api: createTwilioApi(cfg),
    clips: clipStore(cfg.authToken),
    jobs,
    calls,
    limiter: limiter(),
  };
}
