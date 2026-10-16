/**
 * Turn text in a language into TwiML that speaks it:
 *   1. a Twilio <Say> voice exists for the language → <Say voice language>
 *   2. else our TTS (agents provider, gpt-4o-mini-tts when AI_MODE=live) → clip → <Play> signed URL
 *   3. else (fixture TTS, TTS failure) → the English rendering with the English voice, so the caller
 *      always hears something true rather than silence.
 */
import type { Lang } from '@neighborline/core';
import type { Speech, TTS } from '@neighborline/agents';
import type { PhoneConfig } from './config';
import type { ClipStore } from './clips';
import { play, say, type TwimlNode } from './twiml';
import { log, errorText } from '../log';

export interface SpeakOptions {
  /** English rendering, used only when no voice and no TTS audio exist for `lang`. */
  textEn?: string;
  /** Audio already synthesized for this text (the intake read-back), as a data: URL. */
  audioDataUrl?: string;
  /** Clip lifetime when TTS is used (call-backs ring longer than in-call prompts). */
  clipTtlMs?: number;
}

export interface Speaker {
  speak(text: string, lang: Lang, opts?: SpeakOptions): Promise<TwimlNode>;
  /** True when Twilio can speak `lang` itself. */
  hasVoice(lang: Lang): boolean;
}

function fromDataUrl(url: string): { audio: Uint8Array; mimeType: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!m) return null;
  return { mimeType: m[1]!, audio: new Uint8Array(Buffer.from(m[2]!, 'base64')) };
}

/** `base` = '' for in-call TwiML (relative URLs resolve against the webhook URL); absolute for call-backs. */
export function createSpeaker(cfg: PhoneConfig, deps: { tts: TTS | null; clips: ClipStore; base: string }): Speaker {
  const english = (text: string) => say(text, cfg.voices.en ?? { language: 'en-US' });
  const clipUrl = (audio: Uint8Array, mimeType: string, ttl?: number) => `${deps.base}/api/voice/audio/${deps.clips.put(audio, mimeType, ttl)}`;
  return {
    hasVoice: (lang) => Boolean(cfg.voices[lang]),
    async speak(text, lang, opts = {}) {
      const voice = cfg.voices[lang];
      if (voice) return say(text, voice);
      const ready = opts.audioDataUrl ? fromDataUrl(opts.audioDataUrl) : null;
      if (ready) return play(clipUrl(ready.audio, ready.mimeType, opts.clipTtlMs));
      if (deps.tts) {
        let s: Speech | null = null;
        try {
          s = await deps.tts.speak({ text, lang, instructions: 'Warm, calm and slow, like a neighbor on the phone.' });
        } catch (err) {
          log.warn('voice.tts_failed', { lang, error: errorText(err) });
        }
        if (s && !s.useBrowserSpeech && s.audio.byteLength > 0) return play(clipUrl(s.audio, s.mimeType, opts.clipTtlMs));
      }
      return english(opts.textEn ?? text);
    },
  };
}
