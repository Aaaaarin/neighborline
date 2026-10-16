/**
 * Provider contracts. Agents depend only on these interfaces, never on a vendor SDK, so the same
 * agent code runs against Claude, OpenAI or the offline fixture provider.
 */
import type { ZodType, ZodTypeDef } from 'zod';

export type ChatRole = 'user' | 'assistant';
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

export interface GenerateJsonArgs {
  system: string;
  messages: ChatMessage[];
  /** JSON Schema (draft-07 subset) the output must follow. Root must be an object. */
  jsonSchema: Record<string, unknown>;
  /** Tool / response-format name. Letters, digits, `_` and `-` only. */
  schemaName: string;
  description?: string;
  maxTokens?: number;
}
export interface JsonResult {
  /** Parsed JSON (NOT yet validated against the zod schema). */
  json: unknown;
  /** Exact text the model produced (tool input re-serialized for tool-use providers). */
  raw: string;
  usage: Usage;
  model: string;
  /** Local, non-LLM fixes applied while parsing (e.g. "stripped ``` fence"). */
  parseFixes: string[];
}

export interface GenerateStructuredArgs<T> {
  system: string;
  messages: ChatMessage[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  schemaName: string;
  description?: string;
  maxTokens?: number;
}
export interface StructuredResult<T> {
  value: T;
  raw: string;
  usage: Usage;
  model: string;
}

export interface GenerateTextArgs {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}
export interface TextResult {
  text: string;
  usage: Usage;
  model: string;
}

export interface LLM {
  /** e.g. "anthropic:claude-sonnet-5-5", "fixture". Shown in traces. */
  readonly id: string;
  readonly kind: 'anthropic' | 'openai' | 'fixture' | 'scripted' | 'fallback';
  generateJson(args: GenerateJsonArgs): Promise<JsonResult>;
  /** generateJson + zod parse. Throws SchemaValidationError; prefer `runStructured` (validate.ts). */
  generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<StructuredResult<T>>;
  generateText(args: GenerateTextArgs): Promise<TextResult>;
}

export type AudioBytes = Uint8Array;

export interface TranscribeArgs {
  audio: Uint8Array;
  mimeType: string;
  /** BCP-47 primary subtag the caller believes is spoken (improves accuracy). */
  langHint?: string;
  /** Fixture provider only: pick a scenario by id or by original filename. Ignored by live STT. */
  fixtureHint?: { fixtureId?: string; filename?: string };
}
export interface Transcript {
  text: string;
  /** Primary language subtag ("vi"). Detected by the provider or by text heuristics. */
  lang: string;
  durationSec: number | null;
  /** 0..1, from token logprobs when the provider exposes them. */
  confidence?: number;
  provider: string;
  /** How the language was determined. */
  langSource: 'provider' | 'hint' | 'heuristic';
  /** Fixture provider: which scenario matched and how. */
  fixture?: { id: string; matchedBy: 'sha256' | 'marker' | 'fixtureId' | 'filename' | 'default' };
}
export interface STT {
  readonly id: string;
  transcribe(args: TranscribeArgs): Promise<Transcript>;
}

export interface SpeakArgs {
  text: string;
  lang: string;
  voice?: string;
  /** Delivery hint for instruction-following TTS models (gpt-4o-mini-tts). */
  instructions?: string;
}
export interface Speech {
  audio: Uint8Array;
  mimeType: string;
  provider: string;
  /** True when the audio is a placeholder and the browser should speak `text` itself. */
  useBrowserSpeech?: boolean;
}
export interface TTS {
  readonly id: string;
  speak(args: SpeakArgs): Promise<Speech>;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
