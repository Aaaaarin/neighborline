/**
 * Synthesize each demo scenario's transcript into fixtures/audio/<id>.mp3 with OpenAI TTS
 * (gpt-4o-mini-tts, per-scenario voice + delivery instructions), and write manifest.json
 * (id → sha256) so FixtureSTT maps those exact files back to their transcripts offline.
 *
 *   OPENAI_API_KEY=… pnpm --filter @neighborline/agents make-demo-audio [id …]
 *
 * These are synthetic voices for the offline demo and tests — label them as such in the video.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '@neighborline/core';
import { SCENARIOS } from '../src/fixtures/scenarios.js';
import { OpenAITTS } from '../src/providers/openai-audio.js';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set; nothing to do.');
    process.exit(1);
  }
  const only = new Set(process.argv.slice(2));
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'audio');
  mkdirSync(outDir, { recursive: true });
  const tts = new OpenAITTS({ apiKey, model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts' });
  const files: Array<{ id: string; file: string; sha256: string; bytes: number; voice: string }> = [];
  for (const s of SCENARIOS) {
    if (only.size && !only.has(s.id)) continue;
    const speech = await tts.speak({ text: s.transcript, lang: s.lang, voice: s.voice.openaiVoice, instructions: s.voice.instructions });
    const file = `${s.id}.mp3`;
    writeFileSync(join(outDir, file), speech.audio);
    files.push({ id: s.id, file, sha256: sha256Hex(speech.audio), bytes: speech.audio.length, voice: s.voice.openaiVoice });
    console.log(`✓ ${file} (${speech.audio.length} bytes, voice ${s.voice.openaiVoice})`);
  }
  writeFileSync(
    join(outDir, 'manifest.json'),
    `${JSON.stringify({ generatedBy: 'scripts/make-demo-audio.ts', model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', synthetic: true, files }, null, 2)}\n`,
  );
  console.log(`wrote manifest.json with ${files.length} entries`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
