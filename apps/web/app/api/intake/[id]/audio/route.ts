import { Lang } from '@neighborline/core';
import { HttpError } from '@/lib/server/errors';
import { route, type Params } from '@/lib/server/http';
import { services } from '@/lib/server/services';
import type { ScenarioId } from '@/lib/types';

const SAMPLES: ScenarioId[] = ['lan', 'rosa', 'jean', 'walter'];
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** multipart/form-data: audio (file) | sampleId, lang?, photo? */
export const POST = route(async (req: Request, { params }: Params<'id'>) => {
  const { id } = await params;
  const form = await req.formData().catch(() => {
    throw new HttpError(400, 'Expected multipart/form-data');
  });
  const audio = form.get('audio');
  const photo = form.get('photo');
  const sampleId = form.get('sampleId');
  const lang = Lang.safeParse(form.get('lang'));
  if (audio instanceof Blob && audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'Voice notes can be up to 8 MB (about 4 minutes).');
  if (!(audio instanceof Blob) && !(typeof sampleId === 'string' && SAMPLES.includes(sampleId as ScenarioId))) {
    throw new HttpError(400, 'Send a recording in “audio” or pick a sample voice note.');
  }
  return services().submitAudio(id, {
    audio: audio instanceof Blob ? audio : undefined,
    sampleId: typeof sampleId === 'string' && SAMPLES.includes(sampleId as ScenarioId) ? (sampleId as ScenarioId) : undefined,
    lang: lang.success ? lang.data : undefined,
    photo: photo instanceof Blob ? photo : undefined,
  });
});
