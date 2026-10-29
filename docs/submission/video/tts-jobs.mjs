// Renders the voiceover lines listed in a jobs file (written by `build.mjs --vo-jobs <file>`) with OpenAI TTS.
// Runs in .github/workflows/voiceover.yml, where api.openai.com is reachable; the build machine downloads the WAVs
// into $VIDEO_OUT/vo and `build.mjs --with-vo` reuses them by file name. Standalone: no ffmpeg, no takes needed.
//   OPENAI_API_KEY=… node docs/submission/video/tts-jobs.mjs docs/submission/video/vo-jobs.json out-dir
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [jobsFile, outDir] = process.argv.slice(2);
if (!jobsFile || !outDir) throw new Error('usage: node tts-jobs.mjs <jobs.json> <out-dir>');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

for (const j of jobs) {
  if (!/^[\w-]+\.wav$/.test(j.fileName ?? '')) throw new Error(`bad file name in jobs: ${j.fileName}`);
  const out = join(outDir, j.fileName);
  if (existsSync(out)) continue;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: j.model, voice: j.voice, input: j.text, instructions: j.instructions, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${j.id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`${j.id} → ${j.fileName} (${j.text.split(/\s+/).length} words)`);
}
console.log(`done: ${jobs.length} line(s) in ${outDir}`);
