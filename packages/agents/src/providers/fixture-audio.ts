/**
 * Offline STT/TTS.
 *
 * FixtureSTT maps audio back to a scenario transcript by, in order:
 *   1. sha256 of the bytes (fixtures/audio/manifest.json, written by scripts/make-demo-audio.ts)
 *   2. a text marker "NLFIXTURE:<id>" at the start of the bytes (tiny fake audio for tests/demo)
 *   3. fixtureHint.fixtureId, or fixtureHint.filename "<id>.mp3"
 *   4. a configured default scenario (so a real microphone recording still demos offline)
 * FixtureTTS returns a short silent WAV and asks the browser to speak the text itself.
 */
import { sha256Hex } from '@neighborline/core';
import { getScenario, SCENARIO_IDS, type Scenario } from '../fixtures/scenarios.js';
import { ProviderError } from './base.js';
import type { Speech, SpeakArgs, STT, TranscribeArgs, Transcript, TTS } from './types.js';

export const FIXTURE_MARKER = 'NLFIXTURE:';

/** Fake "audio" for a scenario: bytes that FixtureSTT recognizes. */
export const fixtureAudioBytes = (id: string): Uint8Array => new TextEncoder().encode(`${FIXTURE_MARKER}${id}`);

export interface FixtureSTTOptions {
  /** sha256(hex) of audio file → scenario id (see fixtures/audio/manifest.json). */
  audioIndex?: Readonly<Record<string, string>>;
  /** Scenario used when nothing matches; null = throw instead. Default 'lan_vi'. */
  defaultScenarioId?: string | null;
}

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

export class FixtureSTT implements STT {
  readonly id = 'fixture-stt';
  private readonly index: Readonly<Record<string, string>>;
  private readonly defaultId: string | null;

  constructor(opts: FixtureSTTOptions = {}) {
    this.index = opts.audioIndex ?? {};
    this.defaultId = opts.defaultScenarioId === undefined ? 'lan_vi' : opts.defaultScenarioId;
  }

  match(args: TranscribeArgs): { scenario: Scenario; matchedBy: NonNullable<Transcript['fixture']>['matchedBy'] } | null {
    const hashId = this.index[sha256Hex(args.audio)];
    if (hashId) return { scenario: getScenario(hashId), matchedBy: 'sha256' };
    const head = new TextDecoder().decode(args.audio.slice(0, 64));
    if (head.startsWith(FIXTURE_MARKER)) {
      const id = head.slice(FIXTURE_MARKER.length).trim();
      if (SCENARIO_IDS.includes(id)) return { scenario: getScenario(id), matchedBy: 'marker' };
    }
    const hintId = args.fixtureHint?.fixtureId;
    if (hintId && SCENARIO_IDS.includes(hintId)) return { scenario: getScenario(hintId), matchedBy: 'fixtureId' };
    const base = args.fixtureHint?.filename?.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, '');
    if (base && SCENARIO_IDS.includes(base)) return { scenario: getScenario(base), matchedBy: 'filename' };
    if (this.defaultId) return { scenario: getScenario(this.defaultId), matchedBy: 'default' };
    return null;
  }

  async transcribe(args: TranscribeArgs): Promise<Transcript> {
    const m = this.match(args);
    if (!m) throw new ProviderError(this.id, 'audio does not match any fixture scenario');
    return {
      text: m.scenario.transcript,
      lang: m.scenario.lang,
      langSource: 'provider',
      // ~2.3 words per second of calm speech.
      durationSec: Math.round((words(m.scenario.transcript) / 2.3) * 10) / 10,
      confidence: 0.97,
      provider: this.id,
      fixture: { id: m.scenario.id, matchedBy: m.matchedBy },
    };
  }
}

/** 16-bit mono PCM WAV of silence. */
export function silentWav(durationMs = 400, sampleRate = 8000): Uint8Array {
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (off: number, s: string): void => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  return new Uint8Array(buf);
}

export class FixtureTTS implements TTS {
  readonly id = 'fixture-tts';
  async speak(_args: SpeakArgs): Promise<Speech> {
    return { audio: silentWav(), mimeType: 'audio/wav', provider: this.id, useBrowserSpeech: true };
  }
}
