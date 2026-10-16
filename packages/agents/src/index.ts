/**
 * @neighborline/agents — LLM/STT/TTS providers + the four agents. Server-only.
 *
 *   const agents = createAgents(process.env);            // fixtures unless AI_MODE=live
 *   const r = await agents.intake.fromAudio({ audio, mimeType, categories });
 */
import { createProviders, consoleLogger, type AgentEnv, type Providers } from './providers/create.js';
import type { Logger } from './providers/types.js';
import { IntakeAgent } from './intake/intake-agent.js';
import { PolicyCompiler } from './policy/compiler.js';
import { NotifyAgent } from './notify/notify-agent.js';
import { ReportWriter } from './report/report-writer.js';

// Providers
export type * from './providers/types.js';
export { ZERO_USAGE } from './providers/types.js';
export { BaseLLM, ProviderError, SchemaValidationError } from './providers/base.js';
export { AnthropicLLM, DEFAULT_ANTHROPIC_MODEL, type AnthropicLLMOptions } from './providers/anthropic.js';
export { OpenAILLM, DEFAULT_OPENAI_MODEL, type OpenAILLMOptions } from './providers/openai-llm.js';
export {
  OpenAICompatibleLLM,
  COMPAT_STRUCTURED_MODES,
  schemaInstruction,
  type OpenAICompatibleLLMOptions,
  type CompatStructuredMode,
} from './providers/openai-compatible.js';
export { OpenAISTT, OpenAITTS, DEFAULT_STT_MODEL, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE } from './providers/openai-audio.js';
export { FixtureLLM, ScriptedLLM, type Responder, type ScriptStep } from './providers/fixture-llm.js';
export { FixtureSTT, FixtureTTS, fixtureAudioBytes, silentWav, FIXTURE_MARKER } from './providers/fixture-audio.js';
export { FallbackLLM } from './providers/fallback.js';
export { createProviders, loadAudioIndex, consoleLogger, type AgentEnv, type Providers } from './providers/create.js';
export { zodToLlmJsonSchema, toStrictSchema, dropNulls } from './providers/json-schema.js';
export { parseJsonLenient } from './providers/parse-json.js';

// Structured-output pipeline
export {
  runStructured,
  repairPrompt,
  summarizeTrace,
  type RunStructuredArgs,
  type StructuredOutcome,
  type StructuredTrace,
  type AttemptTrace,
  type ValidationIssue,
  type TraceStatus,
} from './validate.js';

// Agents
export { IntakeAgent, LOW_CONFIDENCE, type IntakeResult, type IntakeTextInput, type IntakeAudioInput, type SpokenText } from './intake/intake-agent.js';
export type { CategoryOption } from './intake/prompt.js';
export { detectPayout, canonicalDestination, isGroundedDestination, spokenToSymbols, type DetectedPayout } from './intake/spoken-handles.js';
export { composeReadBack, pickQuestion, questionText, type QuestionKey } from './intake/phrases.js';
export { PolicyCompiler, REQUIRED_APPROVALS, type CompilePolicyInput, type CompilePolicyResult } from './policy/compiler.js';
export { diffPolicies, type PolicyChange } from './policy/diff.js';
export type { PolicyDraft } from './policy/schema.js';
export { NotifyAgent, notifyKeyFor, NOTIFY_KEYS, type NotifyKey, type NotifyInput, type NotifyResult } from './notify/notify-agent.js';
export { translateWithCheck, checkFacts, type TranslationResult, type FactCheck } from './translate.js';
export { ReportWriter, ReportNarrative, MIN_WORDS, MAX_WORDS, type WriteReportInput, type WriteReportResult } from './report/report-writer.js';
export { buildFacts, allowedNumbers, type Fact } from './report/facts.js';
export {
  FixtureInflowSource,
  PayPalToolkitInflowSource,
  parseTransactionSearch,
  summarizeInflows,
  type Inflow,
  type InflowSource,
  type InflowSummary,
  type InflowRange,
} from './report/inflows.js';
export { extractNumbers, ungroundedNumbers } from './numbers.js';
export { detectLang, langName } from './lang.js';

// Fixtures (demo scenarios)
export { SCENARIOS, SCENARIO_IDS, getScenario, type Scenario } from './fixtures/scenarios.js';
export { createFixtureLLM } from './fixtures/responders.js';

export interface Agents {
  providers: Providers;
  intake: IntakeAgent;
  policy: PolicyCompiler;
  notify: NotifyAgent;
  report: ReportWriter;
}

/** One call for the web app: providers from env + all four agents wired to them. */
export function createAgents(env?: AgentEnv, opts: { groupName?: string; logger?: Logger } = {}): Agents {
  const logger = opts.logger ?? consoleLogger;
  const providers = createProviders(env, logger);
  const groupName = opts.groupName ?? 'Eastside Mutual Aid';
  // Phone numbers said without a country code are read in this region (E.164); default US.
  const phoneRegion = (env ?? (process.env as AgentEnv)).PHONE_DEFAULT_REGION?.trim().toUpperCase();
  return {
    providers,
    intake: new IntakeAgent({ llm: providers.llm, stt: providers.stt, tts: providers.tts, groupName, logger, ...(phoneRegion ? { phoneRegion } : {}) }),
    policy: new PolicyCompiler({ llm: providers.llm, groupName }),
    notify: new NotifyAgent({ llm: providers.llm, tts: providers.tts }),
    report: new ReportWriter({ llm: providers.llm }),
  };
}
