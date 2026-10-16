/**
 * The five stage scenarios. Texts come straight from the AI lane's fixtures (packages/agents/fixtures),
 * so the stage, the sample voice notes and the real fixture provider tell exactly the same story.
 * This file only adds stage metadata: titles, blurbs, first name + neighborhood, expected outcome.
 */
import type { Channel, IntakeExtraction, Lang, PayoutDestination } from '@neighborline/core';
import injectEn from '@neighborline/agents/fixtures/scenarios/inject_en.json';
import jeanHt from '@neighborline/agents/fixtures/scenarios/jean_ht.json';
import lanVi from '@neighborline/agents/fixtures/scenarios/lan_vi.json';
import rosaEs from '@neighborline/agents/fixtures/scenarios/rosa_es.json';
import walterEn from '@neighborline/agents/fixtures/scenarios/walter_en.json';
import type { SampleVoiceNote, ScenarioId } from '../../types';

export type ScenarioOutcome = 'success' | 'unclaimed_then_success' | 'blocked';

export interface ScenarioScript {
  id: ScenarioId;
  /** packages/agents fixture id */
  fixtureId: string;
  title: string;
  blurb: string;
  lang: Lang;
  channel: Channel;
  requester: { displayName: string; area: string; contactLabel: string };
  audioSeconds?: number;
  transcript: string;
  transcriptEn: string;
  readback: string;
  readbackEn: string;
  confirmReply: string;
  extraction: IntakeExtraction;
  payout: PayoutDestination;
  outcome: ScenarioOutcome;
}

interface Fixture {
  id: string;
  lang: string;
  transcript: string;
  englishText: string;
  extraction: unknown;
  expected: { readBack: string };
}

/** Same estimate as the fixture speech-to-text (≈2.3 words per second of calm speech). */
const seconds = (t: string) => Math.round(t.split(/\s+/).filter(Boolean).length / 2.3);
const wallet = (w: string) => (w === 'VENMO' ? 'Venmo' : 'PayPal');

function script(
  id: ScenarioId,
  f: Fixture,
  extra: Pick<ScenarioScript, 'title' | 'blurb' | 'channel' | 'requester' | 'confirmReply' | 'outcome'> & { nameOnFile?: string; voice: boolean },
): ScenarioScript {
  const extraction = f.extraction as IntakeExtraction;
  const p = extraction.payout!;
  return {
    id,
    fixtureId: f.id,
    title: extra.title,
    blurb: extra.blurb,
    lang: f.lang as Lang,
    channel: extra.channel,
    requester: extra.requester,
    ...(extra.voice ? { audioSeconds: seconds(f.transcript) } : {}),
    transcript: f.transcript,
    transcriptEn: f.englishText,
    readback: f.expected.readBack,
    readbackEn: `Here is what I understood. Please tell me if it is right: ${extraction.summaryEn} If approved, the money goes to your ${wallet(p.wallet)}: ${p.value}.`,
    confirmReply: extra.confirmReply,
    extraction,
    payout: { ...p, ...(extra.nameOnFile ? { nameOnFile: extra.nameOnFile } : {}) },
    outcome: extra.outcome,
  };
}

export const SCENARIOS: Record<ScenarioId, ScenarioScript> = {
  lan: script('lan', lanVi, {
    title: 'Mrs. Lan',
    blurb: 'Vietnamese voice note · power out 2 days · Venmo',
    channel: 'web_voice',
    requester: { displayName: 'Lan', area: 'Hawthorne', contactLabel: 'Neighborline · Eastside' },
    confirmReply: 'Đúng rồi',
    outcome: 'success',
    nameOnFile: 'Nguyen Thi Lan',
    voice: true,
  }),
  rosa: script('rosa', rosaEs, {
    title: 'Rosa',
    blurb: 'Spanish · groceries · PayPal unclaimed, then rescued',
    channel: 'web_voice',
    requester: { displayName: 'Rosa', area: 'Foster-Powell', contactLabel: 'Neighborline · Eastside' },
    confirmReply: 'Sí, correcto',
    outcome: 'unclaimed_then_success',
    nameOnFile: 'Rosa Delgado',
    voice: true,
  }),
  jean: script('jean', jeanHt, {
    title: 'Jean',
    blurb: 'Haitian Creole · insulin co-pay · Venmo',
    channel: 'web_voice',
    requester: { displayName: 'Jean', area: 'Lents', contactLabel: 'Neighborline · Eastside' },
    confirmReply: 'Wi, se sa',
    outcome: 'success',
    nameOnFile: 'Jean Baptiste',
    voice: true,
  }),
  walter: script('walter', walterEn, {
    title: 'Walter',
    blurb: 'English · oxygen, ride to a warming center · PayPal',
    channel: 'phone',
    requester: { displayName: 'Walter', area: 'Maple St', contactLabel: 'Neighborline · Eastside' },
    confirmReply: 'Yes, that’s right',
    outcome: 'success',
    nameOnFile: 'Walter Reyes',
    voice: true,
  }),
  blocked: script('blocked', injectEn, {
    title: 'Impersonator',
    blurb: 'Injected instructions + lookalike handle · blocked',
    channel: 'sms',
    requester: { displayName: 'Unknown sender', area: 'unknown', contactLabel: 'SMS · +1 (971) 555-0187' },
    confirmReply: '',
    outcome: 'blocked',
    voice: false,
  }),
};

export const SCENARIO_ORDER: ScenarioId[] = ['lan', 'rosa', 'jean', 'walter', 'blocked'];

export const SAMPLE_VOICE_NOTES: SampleVoiceNote[] = (['lan', 'rosa', 'jean', 'walter'] as const).map((id) => {
  const s = SCENARIOS[id];
  const names: Record<string, string> = { vi: 'Tiếng Việt', es: 'Español', ht: 'Kreyòl ayisyen', en: 'English' };
  return {
    id,
    lang: s.lang,
    languageName: names[s.lang] ?? s.lang,
    speaker: s.title,
    seconds: s.audioSeconds ?? 20,
    gist: s.extraction.summaryEn,
  };
});

/** Fixture to use when a real recording arrives but no live speech-to-text is configured. */
export function scenarioForLang(lang: Lang | undefined): ScenarioScript {
  switch (lang) {
    case 'vi':
      return SCENARIOS.lan;
    case 'es':
      return SCENARIOS.rosa;
    case 'ht':
      return SCENARIOS.jean;
    default:
      return SCENARIOS.walter;
  }
}
