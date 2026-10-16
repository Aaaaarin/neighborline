/**
 * Demo scenarios (fixtures/scenarios/*.json). Validated with zod on load so a typo in a fixture
 * fails loudly, not as a wrong demo.
 */
import { z } from 'zod';
import { Channel, IntakeExtraction, sha256Hex } from '@neighborline/core';
import lanVi from '../../fixtures/scenarios/lan_vi.json';
import rosaEs from '../../fixtures/scenarios/rosa_es.json';
import jeanHt from '../../fixtures/scenarios/jean_ht.json';
import walterEn from '../../fixtures/scenarios/walter_en.json';
import injectEn from '../../fixtures/scenarios/inject_en.json';
import missingPayoutEs from '../../fixtures/scenarios/missing_payout_es.json';
import translations from '../../fixtures/translations.json';

export const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string(),
  lang: z.string(),
  channel: Channel,
  voice: z.object({ openaiVoice: z.string(), instructions: z.string() }),
  transcript: z.string().min(1),
  englishText: z.string().min(1),
  extraction: IntakeExtraction,
  expected: z.object({
    status: z.enum(['awaiting_confirmation', 'needs_clarification']),
    readBack: z.string(),
    clarifyingQuestion: z.string().nullable(),
  }),
  notifications: z.array(
    z.object({ key: z.string(), vars: z.record(z.string()), text: z.string() }),
  ),
  demo: z.object({ amountCents: z.number().int().nonnegative(), payoutOutcome: z.string() }),
});
export type Scenario = z.infer<typeof Scenario>;

export const SCENARIOS: readonly Scenario[] = [lanVi, rosaEs, jeanHt, walterEn, injectEn, missingPayoutEs].map((s) => Scenario.parse(s));
export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);

export function getScenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown fixture scenario '${id}' (have: ${SCENARIO_IDS.join(', ')})`);
  return s;
}

/** Normalized text key: NFC, whitespace collapsed, trimmed. */
export const textKey = (text: string): string => sha256Hex(text.normalize('NFC').replace(/\s+/g, ' ').trim());

const BY_TEXT = new Map(SCENARIOS.map((s) => [textKey(s.transcript), s]));
export const scenarioByTranscript = (text: string): Scenario | undefined => BY_TEXT.get(textKey(text));

export const FixtureTranslation = z.object({ lang: z.string(), source: z.string(), translation: z.string(), backTranslation: z.string() });
export type FixtureTranslation = z.infer<typeof FixtureTranslation>;
export const TRANSLATIONS: readonly FixtureTranslation[] = z.array(FixtureTranslation).parse(translations.entries);
