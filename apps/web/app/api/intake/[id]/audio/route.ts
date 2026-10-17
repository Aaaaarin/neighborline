import { Lang } from '@neighborline/core';
import { HttpError } from '@/lib/server/errors';
import { route, type Params } from '@/lib/server/http';
import { limitIntake, requireRequester } from '@/lib/server/security/access';
import { services } from '@/lib/server/services';
import type { ScenarioId } from '@/lib/types';

const SAMPLES: ScenarioId[] = ['lan', 'rosa', 'jean', 'walter'];
/** Voice notes are capped at 2 minutes. */
const MAX_AUDIO_SECONDS = 120;
/** 2 minutes at up to ~256 kbit/s (MediaRecorder Opus is usually 32–128 kbit/s). */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_AUDIO_BYTES + MAX_PHOTO_BYTES + 64 * 1024;

/**
 * multipart/form-data: audio (file) | sampleId, lang?, durationSeconds?, photo?
 * Size is checked from Content-Length BEFORE the body is read (413), then per part; a declared
 * duration over 2 minutes is refused. Same-origin is enforced by route() for multipart too.
 */
export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const declared = Number(req.headers.get('content-length'));
  if (!Number.isFinite(declared) || declared <= 0) throw new HttpError(411, 'Content-Length is required for uploads.');
  if (declared > MAX_FORM_BYTES) throw new HttpError(413, 'Voice notes can be up to 2 minutes.');
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.startsWith('multipart/form-data')) throw new HttpError(415, 'Expected multipart/form-data');
  const viewer = await requireRequester(req, id);
  const form = await req.formData().catch(() => {
    throw new HttpError(400, 'Expected multipart/form-data');
  });
  const audio = form.get('audio');
  const photo = form.get('photo');
  const sampleId = form.get('sampleId');
  const lang = Lang.safeParse(form.get('lang'));
  const seconds = Number(form.get('durationSeconds'));
  if (audio instanceof Blob && audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'Voice notes can be up to 2 minutes.');
  if (Number.isFinite(seconds) && seconds > MAX_AUDIO_SECONDS) throw new HttpError(413, 'Voice notes can be up to 2 minutes.');
  if (photo instanceof Blob && photo.size > MAX_PHOTO_BYTES) throw new HttpError(413, 'Photos can be up to 4 MB.');
  if (!(audio instanceof Blob) && !(typeof sampleId === 'string' && SAMPLES.includes(sampleId as ScenarioId))) {
    throw new HttpError(400, 'Send a recording in “audio” or pick a sample voice note.');
  }
  // A bundled sample costs no speech-to-text; a real recording does when AI_MODE=live.
  await limitIntake(req, viewer, audio instanceof Blob ? {} : { ai: false });
  return services().submitAudio(id, {
    audio: audio instanceof Blob ? audio : undefined,
    sampleId: typeof sampleId === 'string' && SAMPLES.includes(sampleId as ScenarioId) ? (sampleId as ScenarioId) : undefined,
    lang: lang.success ? lang.data : undefined,
    photo: photo instanceof Blob ? photo : undefined,
  });
});
