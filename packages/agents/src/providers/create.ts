/**
 * Provider selection from env. Zero credentials → everything runs on fixtures.
 *
 *   AI_MODE=fixture (default) → FixtureLLM / FixtureSTT / FixtureTTS
 *   AI_MODE=live              → LLM_PROVIDER (anthropic|openai) if its key exists, else the other
 *                               provider if its key exists, else fixtures (logged warning).
 *                               STT/TTS: OpenAI when OPENAI_API_KEY exists, else fixtures.
 *   AI_FALLBACK=fixture       → live LLM errors fall back to fixtures (demo safety net; logged).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFixtureLLM } from '../fixtures/responders.js';
import { AnthropicLLM, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
import { FixtureSTT, FixtureTTS } from './fixture-audio.js';
import { FallbackLLM } from './fallback.js';
import { DEFAULT_OPENAI_MODEL, OpenAILLM } from './openai-llm.js';
import { DEFAULT_STT_MODEL, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE, OpenAISTT, OpenAITTS } from './openai-audio.js';
import type { LLM, Logger, STT, TTS } from './types.js';

export interface AgentEnv {
  AI_MODE?: string;
  LLM_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_STRICT_TOOLS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_REASONING_EFFORT?: string;
  OPENAI_STT_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  AI_FALLBACK?: string;
  AI_FIXTURE_DEFAULT_AUDIO?: string;
  AI_FIXTURE_AUDIO_DIR?: string;
  [key: string]: string | undefined;
}

export interface Providers {
  mode: 'fixture' | 'live';
  llm: LLM;
  stt: STT;
  tts: TTS;
  /** Human-readable decisions, for the /trust "Sandbox reality" panel and logs. */
  notes: string[];
}

export const consoleLogger: Logger = {
  info: (m, meta) => console.info(`[agents] ${m}`, meta ?? ''),
  warn: (m, meta) => console.warn(`[agents] ${m}`, meta ?? ''),
  error: (m, meta) => console.error(`[agents] ${m}`, meta ?? ''),
};

const present = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';

/** sha256 → scenario id, written by scripts/make-demo-audio.ts. Missing file = empty index. */
export function loadAudioIndex(dir?: string): Record<string, string> {
  const candidates: string[] = [];
  if (dir) candidates.push(dir);
  try {
    // Non-literal so bundlers do not try to treat the directory as an asset.
    const rel = ['..', '..', 'fixtures', 'audio', ''].join('/');
    candidates.push(fileURLToPath(new URL(rel, import.meta.url)));
  } catch {
    /* import.meta.url not a file URL (bundled) */
  }
  candidates.push(`${process.cwd()}/packages/agents/fixtures/audio`, `${process.cwd()}/../../packages/agents/fixtures/audio`);
  for (const base of candidates) {
    try {
      const manifest = JSON.parse(readFileSync(`${base.replace(/\/$/, '')}/manifest.json`, 'utf8')) as { files?: Array<{ id: string; sha256: string }> };
      return Object.fromEntries((manifest.files ?? []).map((f) => [f.sha256, f.id]));
    } catch {
      /* try next */
    }
  }
  return {};
}

export function createProviders(env: AgentEnv = process.env as AgentEnv, logger: Logger = consoleLogger): Providers {
  const notes: string[] = [];
  const fixtureLLM = createFixtureLLM();
  const defaultAudio = env.AI_FIXTURE_DEFAULT_AUDIO === 'none' ? null : (env.AI_FIXTURE_DEFAULT_AUDIO ?? 'lan_vi');
  const fixtureSTT = new FixtureSTT({ audioIndex: loadAudioIndex(env.AI_FIXTURE_AUDIO_DIR), defaultScenarioId: defaultAudio });
  const fixtureTTS = new FixtureTTS();
  const mode = (env.AI_MODE ?? 'fixture').trim().toLowerCase();

  if (mode !== 'live') {
    if (mode !== 'fixture') logger.warn(`unknown AI_MODE '${env.AI_MODE}', using fixtures`);
    notes.push('AI_MODE=fixture: offline, deterministic fixture providers (no model calls).');
    return { mode: 'fixture', llm: fixtureLLM, stt: fixtureSTT, tts: fixtureTTS, notes };
  }

  const anthropic = (): LLM | null =>
    present(env.ANTHROPIC_API_KEY)
      ? new AnthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL, strictTools: env.ANTHROPIC_STRICT_TOOLS !== 'false' })
      : null;
  const effort = env.OPENAI_REASONING_EFFORT as 'minimal' | 'low' | 'medium' | 'high' | undefined;
  const openai = (): LLM | null =>
    present(env.OPENAI_API_KEY)
      ? new OpenAILLM({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL, ...(effort ? { reasoningEffort: effort } : {}) })
      : null;
  const wanted = (env.LLM_PROVIDER ?? 'anthropic').trim().toLowerCase() === 'openai' ? 'openai' : 'anthropic';
  let llm = wanted === 'openai' ? openai() : anthropic();
  if (!llm) {
    llm = wanted === 'openai' ? anthropic() : openai();
    if (llm) {
      logger.warn(`LLM_PROVIDER=${wanted} has no API key; using ${llm.id}`);
      notes.push(`LLM: ${wanted} key missing, using ${llm.id}.`);
    }
  }
  if (!llm) {
    logger.warn('AI_MODE=live but no ANTHROPIC_API_KEY / OPENAI_API_KEY; LLM falls back to fixtures');
    notes.push('LLM: no API key, using fixtures.');
    llm = fixtureLLM;
  } else {
    notes.push(`LLM: ${llm.id}.`);
    if (env.AI_FALLBACK === 'fixture') {
      llm = new FallbackLLM(llm, fixtureLLM, logger);
      notes.push('AI_FALLBACK=fixture: model errors fall back to fixtures (logged).');
    }
  }

  let stt: STT = fixtureSTT;
  let tts: TTS = fixtureTTS;
  if (present(env.OPENAI_API_KEY)) {
    stt = new OpenAISTT({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_STT_MODEL || DEFAULT_STT_MODEL });
    tts = new OpenAITTS({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_TTS_MODEL || DEFAULT_TTS_MODEL, voice: env.OPENAI_TTS_VOICE || DEFAULT_TTS_VOICE });
    notes.push(`STT: ${stt.id}. TTS: ${tts.id}.`);
  } else {
    logger.warn('no OPENAI_API_KEY; speech-to-text and text-to-speech use fixtures');
    notes.push('STT/TTS: no OpenAI key, using fixtures (browser speech for read-backs).');
  }
  return { mode: 'live', llm, stt, tts, notes };
}
