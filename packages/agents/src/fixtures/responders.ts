/**
 * Fixture-mode answers for each schema. Deterministic and offline:
 *  - IntakeExtraction: scenario by transcript hash, else the rule-based extractor
 *  - PolicyDraft: offline parser
 *  - Translation / BackTranslation: fixtures/translations.json, else identity (→ English fallback)
 *  - ReportNarrative: template built from the <facts> block
 */
import { FixtureLLM, type Responder } from '../providers/fixture-llm.js';
import { readDataBlock } from '../prompt-safety.js';
import { heuristicExtract } from '../intake/heuristic.js';
import { parsePolicyOffline } from '../policy/offline-parser.js';
import { templateNarrative } from '../report/template.js';
import type { Fact } from '../report/facts.js';
import { scenarioByTranscript, TRANSLATIONS } from './scenarios.js';

const unescape = (s: string): string => s.replace(/‹/g, '<').replace(/›/g, '>');

const intake: Responder = (ctx) => {
  const text = unescape(readDataBlock(ctx.firstUser, 'request_text') ?? '');
  const keys = (readDataBlock(ctx.firstUser, 'categories') ?? '')
    .split('\n')
    .map((l) => /^- ([a-z0-9_]+):/.exec(l)?.[1])
    .filter((k): k is string => !!k);
  const hint = readDataBlock(ctx.firstUser, 'lang_hint');
  const scenario = scenarioByTranscript(text);
  if (scenario) {
    const category = keys.includes(scenario.extraction.category) ? scenario.extraction.category : 'other';
    return { ...scenario.extraction, category, englishText: scenario.englishText };
  }
  return heuristicExtract(text, keys, hint);
};

const policy: Responder = (ctx) => {
  const prev = readDataBlock(ctx.firstUser, 'previous_policy');
  const known = prev ? (JSON.parse(unescape(prev)) as { categories: Array<{ key: string; label?: string }> }).categories.map((c) => ({ key: c.key, label: c.label ?? c.key })) : [];
  return parsePolicyOffline(unescape(readDataBlock(ctx.firstUser, 'policy_text') ?? ''), known);
};

const translation: Responder = (ctx) => {
  const source = unescape(readDataBlock(ctx.firstUser, 'source_text') ?? '');
  const lang = /Language: ([a-z-]+)/i.exec(ctx.firstUser)?.[1] ?? '';
  const hit = TRANSLATIONS.find((t) => t.lang === lang && t.source === source);
  return { translation: hit?.translation ?? source };
};

const backTranslation: Responder = (ctx) => {
  const text = unescape(readDataBlock(ctx.firstUser, 'text') ?? '');
  return { english: TRANSLATIONS.find((t) => t.translation === text)?.backTranslation ?? text };
};

const narrative: Responder = (ctx) => {
  const facts = JSON.parse(unescape(readDataBlock(ctx.firstUser, 'facts') ?? '[]')) as Fact[];
  return templateNarrative(facts);
};

export const FIXTURE_RESPONDERS: Readonly<Record<string, Responder>> = {
  IntakeExtraction: intake,
  PolicyDraft: policy,
  Translation: translation,
  BackTranslation: backTranslation,
  ReportNarrative: narrative,
};

export const createFixtureLLM = (): FixtureLLM => new FixtureLLM(FIXTURE_RESPONDERS);
