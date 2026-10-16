import { route } from '@/lib/server/http';
import { services } from '@/lib/server/services';

/** Extension to SPEC §5: bundled sample voice notes for visitors without a microphone. */
export const GET = route(async () => services().listSampleVoiceNotes());
