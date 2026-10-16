/**
 * IntakeAgent: voice/text in any language → transcript → IntakeExtraction (zod, repaired,
 * grounded) → warm read-back in the neighbor's language (+ one clarifying question if needed).
 * It has no tools and never sees amounts it could act on: core computes amounts from policy.
 */
import { isCatalogLang, render, type IntakeExtraction } from '@neighborline/core';
import type { LLM, Logger, STT, TTS, Transcript } from '../providers/types.js';
import { detectLang } from '../lang.js';
import { translateWithCheck } from '../translate.js';
import { runStructured, type StructuredTrace } from '../validate.js';
import { finalizeExtraction, intakeSemanticIssues } from './grounding.js';
import { composeReadBack, extra, pickQuestion, questionText, walletLabel, type QuestionKey } from './phrases.js';
import { intakeModelSchema, intakeSystemPrompt, intakeUserPrompt, type CategoryOption } from './prompt.js';

export const LOW_CONFIDENCE = 0.6;
const REQUIRED: ReadonlyArray<IntakeExtraction['missing'][number]> = ['payout', 'category'];

export interface IntakeAgentDeps {
  llm: LLM;
  stt?: STT;
  tts?: TTS;
  groupName?: string;
  logger?: Logger;
  /** Region a phone number said without a country code is read in (ISO 3166 code, default US). */
  phoneRegion?: string;
}

export interface IntakeTextInput {
  text: string;
  /** Active policy categories: key + English label. The model must pick one of these or 'other'. */
  categories: readonly CategoryOption[];
  langHint?: string;
  /** Synthesize the read-back with TTS (needs `tts`). */
  speakReadBack?: boolean;
}
export interface IntakeAudioInput extends Omit<IntakeTextInput, 'text'> {
  audio: Uint8Array;
  mimeType: string;
  fixtureHint?: { fixtureId?: string; filename?: string };
}

export interface SpokenText {
  text: string;
  lang: string;
  audio?: { base64: string; mimeType: string; useBrowserSpeech: boolean };
}

export interface IntakeResult {
  /** True when a validated extraction exists (it may still need clarification). */
  ok: boolean;
  status: 'awaiting_confirmation' | 'needs_clarification';
  /** Why clarification is needed: 'missing:payout', 'low_confidence', 'invalid_output', … */
  reasons: string[];
  transcript: Omit<Transcript, 'text'> & { text: string };
  lang: string;
  originalText: string;
  englishText: string;
  extraction: IntakeExtraction | null;
  readBack: SpokenText;
  clarifyingQuestion: (SpokenText & { key: QuestionKey }) | null;
  trace: StructuredTrace;
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

export class IntakeAgent {
  constructor(private readonly deps: IntakeAgentDeps) {}

  private get handleOpts(): { phoneRegion?: string } {
    return this.deps.phoneRegion ? { phoneRegion: this.deps.phoneRegion } : {};
  }

  async fromAudio(input: IntakeAudioInput): Promise<IntakeResult> {
    if (!this.deps.stt) throw new Error('IntakeAgent.fromAudio needs an STT provider');
    const transcript = await this.deps.stt.transcribe({
      audio: input.audio,
      mimeType: input.mimeType,
      ...(input.langHint ? { langHint: input.langHint } : {}),
      ...(input.fixtureHint ? { fixtureHint: input.fixtureHint } : {}),
    });
    return this.run({ ...input, text: transcript.text, langHint: input.langHint ?? transcript.lang }, transcript);
  }

  async fromText(input: IntakeTextInput): Promise<IntakeResult> {
    const lang = input.langHint ?? detectLang(input.text);
    return this.run(input, { text: input.text, lang, langSource: input.langHint ? 'hint' : 'heuristic', durationSec: null, provider: 'text' });
  }

  private async run(input: IntakeTextInput, transcript: Transcript): Promise<IntakeResult> {
    const text = input.text.trim();
    const keys = input.categories.map((c) => c.key);
    const outcome = await runStructured({
      llm: this.deps.llm,
      schema: intakeModelSchema(keys),
      schemaName: 'IntakeExtraction',
      label: 'intake',
      system: intakeSystemPrompt(this.deps.groupName ?? 'the group'),
      messages: [{ role: 'user', content: intakeUserPrompt(text, input.categories, input.langHint) }],
      semanticCheck: (v) => intakeSemanticIssues(v, text, this.handleOpts),
    });

    let value = outcome.ok ? outcome.value : undefined;
    if (!outcome.ok && outcome.schemaValidValue && outcome.errors.every((e) => e.source === 'semantic')) {
      // Only grounding problems left: keep the record, drop what is ungrounded, ask the person.
      value = outcome.schemaValidValue;
      outcome.trace.notes.push('kept extraction after repair; ungrounded fields dropped');
    }
    if (!value) return this.failed(input, transcript, outcome.trace);

    const { englishText, ...rest } = value;
    const { extraction, notes } = finalizeExtraction<IntakeExtraction>(rest, text, this.handleOpts);
    outcome.trace.notes.push(...notes);
    const lang = extraction.lang;
    const lowConfidence = extraction.confidence < LOW_CONFIDENCE;
    const reasons = [
      ...(lowConfidence ? ['low_confidence'] : []),
      ...extraction.missing.filter((m) => REQUIRED.includes(m)).map((m) => `missing:${m}`),
    ];
    const qKey = pickQuestion(extraction.missing, lowConfidence);
    const readBackText = await this.readBack(extraction, lang, outcome.trace);
    const qText = qKey ? await this.localize(questionText(qKey, lang), lang, [], outcome.trace) : null;
    return {
      ok: true,
      status: reasons.length ? 'needs_clarification' : 'awaiting_confirmation',
      reasons,
      transcript: { ...transcript, text },
      lang,
      originalText: text,
      englishText,
      extraction,
      readBack: await this.spoken(readBackText, lang, input.speakReadBack),
      clarifyingQuestion: qKey && qText ? { key: qKey, ...(await this.spoken(qText, lang, input.speakReadBack)) } : null,
      trace: outcome.trace,
    };
  }

  /** Catalog languages use vetted text as-is; others get a translation that must pass the back-translation fact check. */
  private async localize(text: string, lang: string, facts: string[], trace: StructuredTrace): Promise<string> {
    if (isCatalogLang(lang)) return text;
    const t = await translateWithCheck(this.deps.llm, { text, targetLang: lang, facts });
    trace.notes.push(t.translated ? `phrase translated to ${lang} (back-translation check passed)` : `phrase kept in English for ${lang}`);
    return t.text;
  }

  private async readBack(x: IntakeExtraction, lang: string, trace: StructuredTrace): Promise<string> {
    if (isCatalogLang(lang)) return composeReadBack(x, lang);
    const parts = [await this.localize(render('readback_intro', 'en'), lang, [], trace), x.summaryNative.trim()];
    if (x.payout) {
      const wallet = walletLabel(x.payout.wallet);
      parts.push(await this.localize(extra('payout_line', 'en', { wallet, receiver: x.payout.value }), lang, [wallet, x.payout.value], trace));
    }
    return parts.join(' ');
  }

  private async spoken(text: string, lang: string, speak?: boolean): Promise<SpokenText> {
    if (!speak || !this.deps.tts) return { text, lang };
    try {
      const s = await this.deps.tts.speak({ text, lang });
      return { text, lang, audio: { base64: toBase64(s.audio), mimeType: s.mimeType, useBrowserSpeech: s.useBrowserSpeech ?? false } };
    } catch (e) {
      this.deps.logger?.warn('read-back TTS failed; browser speech fallback', { error: e instanceof Error ? e.message : String(e) });
      return { text, lang };
    }
  }

  private async failed(input: IntakeTextInput, transcript: Transcript, trace: StructuredTrace): Promise<IntakeResult> {
    const lang = input.langHint ?? transcript.lang ?? 'en';
    const ask = extra('ask_again', lang);
    return {
      ok: false,
      status: 'needs_clarification',
      reasons: ['invalid_output'],
      transcript: { ...transcript, text: input.text },
      lang,
      originalText: input.text,
      englishText: '',
      extraction: null,
      readBack: await this.spoken(ask, lang, input.speakReadBack),
      clarifyingQuestion: { key: 'ask_again', text: ask, lang },
      trace,
    };
  }
}
