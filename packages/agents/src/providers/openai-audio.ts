/**
 * OpenAI speech-to-text and text-to-speech.
 *
 * STT (audio.transcriptions.create):
 *  - gpt-4o-transcribe / gpt-4o-mini-transcribe: response_format 'json' only; we request
 *    include: ['logprobs'] and turn the mean token logprob into a 0..1 confidence. No language
 *    field is returned, so language comes from the hint or text heuristics.
 *  - gpt-transcribe: returns `languages[].code`.
 *  - whisper-1: response_format 'verbose_json' → `language` (English name) + `duration`.
 * TTS (audio.speech.create): gpt-4o-mini-tts with `instructions` for warm, slow delivery.
 * Verified against openai 7.34.0 type definitions (TranscriptionCreateParams, SpeechCreateParams).
 */
import OpenAI, { toFile } from 'openai';
import { ProviderError } from './base.js';
import { detectLang, langFromWhisperName, langName } from '../lang.js';
import type { Speech, SpeakArgs, STT, TranscribeArgs, Transcript, TTS } from './types.js';

export const DEFAULT_STT_MODEL = 'gpt-4o-transcribe';
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_TTS_VOICE = 'coral';

type AudioClient = Pick<OpenAI, 'audio'>;

const EXT: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a',
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac',
};
export const extensionFor = (mimeType: string): string => EXT[mimeType.split(';')[0]?.trim().toLowerCase() ?? ''] ?? 'webm';

export interface OpenAISTTOptions {
  apiKey: string;
  model?: string;
  client?: AudioClient;
}

export class OpenAISTT implements STT {
  readonly id: string;
  private readonly client: AudioClient;
  private readonly model: string;

  constructor(opts: OpenAISTTOptions) {
    this.model = opts.model ?? DEFAULT_STT_MODEL;
    this.id = `openai:${this.model}`;
    this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async transcribe(args: TranscribeArgs): Promise<Transcript> {
    const file = await toFile(args.audio, `request.${extensionFor(args.mimeType)}`, { type: args.mimeType });
    const language = args.langHint?.split(/[-_]/)[0];
    try {
      if (this.model === 'whisper-1') {
        const r = await this.client.audio.transcriptions.create({
          file, model: this.model, response_format: 'verbose_json', ...(language ? { language } : {}),
        });
        const providerLang = langFromWhisperName(r.language);
        return {
          text: r.text.trim(),
          lang: providerLang ?? language ?? detectLang(r.text),
          langSource: providerLang ? 'provider' : language ? 'hint' : 'heuristic',
          durationSec: r.duration,
          provider: this.id,
        };
      }
      const supportsLogprobs = this.model.startsWith('gpt-4o');
      const r = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
        response_format: 'json',
        ...(language ? { language } : {}),
        ...(supportsLogprobs ? { include: ['logprobs' as const] } : {}),
      });
      const providerLang = r.languages?.[0]?.code?.split(/[-_]/)[0];
      const logprobs = (r.logprobs ?? []).map((l) => l.logprob).filter((x): x is number => typeof x === 'number');
      const confidence = logprobs.length ? Math.exp(logprobs.reduce((a, b) => a + b, 0) / logprobs.length) : undefined;
      const durationSec = r.usage?.type === 'duration' ? r.usage.seconds : null;
      return {
        text: r.text.trim(),
        lang: providerLang ?? language ?? detectLang(r.text),
        langSource: providerLang ? 'provider' : language ? 'hint' : 'heuristic',
        durationSec,
        ...(confidence !== undefined ? { confidence: Math.round(confidence * 1000) / 1000 } : {}),
        provider: this.id,
      };
    } catch (e) {
      throw new ProviderError(this.id, `audio.transcriptions.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
  }
}

export interface OpenAITTSOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  client?: AudioClient;
}

export class OpenAITTS implements TTS {
  readonly id: string;
  private readonly client: AudioClient;
  private readonly model: string;
  private readonly voice: string;

  constructor(opts: OpenAITTSOptions) {
    this.model = opts.model ?? DEFAULT_TTS_MODEL;
    this.voice = opts.voice ?? DEFAULT_TTS_VOICE;
    this.id = `openai:${this.model}`;
    this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async speak(args: SpeakArgs): Promise<Speech> {
    const instructionsOk = !this.model.startsWith('tts-1');
    try {
      const res = await this.client.audio.speech.create({
        model: this.model,
        voice: args.voice ?? this.voice,
        input: args.text.slice(0, 4096),
        response_format: 'mp3',
        ...(instructionsOk
          ? { instructions: args.instructions ?? `Speak in ${langName(args.lang)} at a calm, slightly slow pace with a warm, reassuring tone, like a kind neighbor.` }
          : {}),
      });
      return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: 'audio/mpeg', provider: this.id };
    } catch (e) {
      throw new ProviderError(this.id, `audio.speech.create failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
  }
}
