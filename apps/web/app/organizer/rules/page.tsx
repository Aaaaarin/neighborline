import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { PageShell } from '@/components/PageShell';
import { RulesEditor } from '@/components/rules/RulesEditor';
import { SESSION_COOKIE, decodeSession } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

export const metadata: Metadata = {
  title: 'Group rules',
  description: 'Organizers write the rules in plain English, the AI drafts them as code with a quote for every cap, and two organizers sign to activate a new version.',
};
export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const svc = services();
  const jar = await cookies();
  const [view, group, session] = await Promise.all([svc.policyEditor(), svc.getGroup(), svc.liveSession(decodeSession(jar.get(SESSION_COOKIE)?.value))]);
  return (
    <PageShell footer={false}>
      <RulesEditor initial={view} session={session} organizers={group.organizers} />
    </PageShell>
  );
}
