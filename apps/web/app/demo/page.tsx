import type { Metadata } from 'next';
import { Stage, type ScenarioOption } from '@/components/stage/Stage';
import { SCENARIOS, SCENARIO_ORDER } from '@/lib/server/fixtures/scenarios';
import { services } from '@/lib/server/services';
import type { PlayMode, ScenarioId } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Live demo',
  description: 'Watch a voice note in Vietnamese become a Venmo payout, approved by two neighbors, in real time.',
};
export const dynamic = 'force-dynamic';

export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const svc = services();
  const group = await svc.getGroup();
  const scenarios: ScenarioOption[] = SCENARIO_ORDER.map((id) => {
    const s = SCENARIOS[id];
    return { id, title: s.title, blurb: s.blurb, lang: s.lang, sms: s.channel === 'sms', contactLabel: s.requester.contactLabel };
  });
  const scenario = (SCENARIO_ORDER as string[]).includes(sp.scenario ?? '') ? (sp.scenario as ScenarioId) : 'lan';
  const mode: PlayMode = sp.mode === 'manual' ? 'manual' : 'auto';
  const speed = sp.speed ? Math.min(20, Math.max(0.25, Number(sp.speed) || 1)) : undefined;
  return (
    <Stage
      organizers={group.organizers}
      scenarios={scenarios}
      modes={svc.modes}
      initial={{ scenario, mode, speed, autoplay: sp.autoplay === '1' }}
    />
  );
}
