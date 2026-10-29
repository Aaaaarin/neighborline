// --with-vo: narrator lines + Mrs. Lan's voice note via OpenAI gpt-4o-mini-tts (needs OPENAI_API_KEY).
// Each line is cached by a hash of (model, voice, instructions, text), so re-runs only pay for changed lines.
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS, ffmpeg, log, probeDuration } from './common.mjs';

const MODEL = process.env.VO_MODEL ?? 'gpt-4o-mini-tts';
const NARRATOR = {
  voice: process.env.VO_VOICE ?? 'coral',
  instructions:
    'Warm, calm, unhurried narrator. Plain American English. Like a neighbor explaining something at a kitchen table. No announcer energy. Slight pause at commas and periods.',
};
// Her words are the first two sentences of the intake fixture (packages/agents/fixtures/scenarios/lan_vi.json), taken
// from the cold-open shot in timeline.json, so the voice, the on-screen words and the app agree.
export const LAN_VOICE = {
  id: 'lan_voice',
  voice: process.env.VO_LAN_VOICE ?? 'sage',
  instructions:
    'An older Vietnamese woman, tired and cold but polite, speaking natural Northern-accented Vietnamese, slowly, as if leaving a voice message on a phone.',
};

async function tts({ text, voice, instructions }, out) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, voice, input: text, instructions, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

/** Every TTS line for this timeline, with the cache file name the build looks for (also used by --vo-jobs). */
export function voJobs(T) {
  const open = T.shots.find((s) => s.kind === 'voicenote');
  const lan = { ...LAN_VOICE, text: open.voice.vi, start: open.start + open.voice.start, window: +(open.dur - open.voice.start - 0.2).toFixed(2) };
  return [...T.vo.map((v) => ({ id: v.id, start: v.start, window: v.window, text: v.text, ...NARRATOR })), lan].map((j) => {
    const key = createHash('sha256').update(JSON.stringify([MODEL, j.voice, j.instructions, j.text])).digest('hex').slice(0, 12);
    return { ...j, model: MODEL, fileName: `${j.id}-${key}.wav` };
  });
}

/**
 * Generates (or reuses) every line; returns { durations: {V1: s, …}, files: [{id, file, start}] }. Lines already in
 * DIRS.vo (e.g. rendered by .github/workflows/voiceover.yml and downloaded) are never re-requested, so the key is only
 * needed for lines that are missing.
 */
export async function generateVo(T) {
  const files = [];
  const durations = {};
  const jobs = voJobs(T);
  const missing = jobs.filter((j) => !existsSync(join(DIRS.vo, j.fileName)));
  if (missing.length && !process.env.OPENAI_API_KEY) throw new Error(`--with-vo needs OPENAI_API_KEY for ${missing.length} line(s) not in ${DIRS.vo}: ${missing.map((j) => j.fileName).join(', ')}`);
  for (const j of jobs) {
    const file = join(DIRS.vo, j.fileName);
    if (!existsSync(file)) {
      log(`TTS ${j.id} (${j.text.split(/\s+/).length} words)`);
      await tts(j, file);
    }
    durations[j.id] = probeDuration(file);
    if (j.window && durations[j.id] > j.window + 0.2) log(`WARNING ${j.id}: ${durations[j.id].toFixed(2)} s is longer than its ${j.window} s window. Regenerate brisker or retime the window in timeline.json`);
    files.push({ id: j.id, file, start: j.start });
  }
  return { durations, files };
}

/**
 * Mixes the VO onto the captioned video: lines placed by start time, phone-speaker EQ on Lan, loudness −14 LUFS.
 * Mrs. Lan's line is never sped up; if it runs past the cold open, lengthen shot s00 and shift V1 in timeline.json.
 */
export function mixVo(videoIn, files, out) {
  const args = ['-i', videoIn];
  const chains = [];
  files.forEach((f, i) => {
    args.push('-i', f.file);
    const ms = Math.round(f.start * 1000);
    const eq = f.id === 'lan_voice' ? 'highpass=f=250,lowpass=f=3800,acompressor=threshold=-18dB:ratio=3,volume=0.8,' : '';
    chains.push(`[${i + 1}:a]${eq}aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`);
  });
  chains.push(`${files.map((_, i) => `[a${i}]`).join('')}amix=inputs=${files.length}:normalize=0,apad,loudnorm=I=-14:TP=-1:LRA=11[a]`);
  ffmpeg([...args, '-filter_complex', chains.join(';'), '-map', '0:v', '-map', '[a]', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out]);
}
