import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { OrganizerQueue } from '@/components/organizer/OrganizerQueue';
import { PageShell } from '@/components/PageShell';
import { SESSION_COOKIE, decodeSession } from '@/lib/server/passkeys/session';
import { services } from '@/lib/server/services';

export const metadata: Metadata = { title: 'Organizer queue', description: 'Approve or decline requests. Every payout needs two organizers, each signing with a passkey.' };
export const dynamic = 'force-dynamic';

export default async function OrganizerPage() {
  const svc = services();
  const [group, requests, roster, jar] = await Promise.all([svc.getGroup(), svc.listRequests(), svc.passkeyRoster(), cookies()]);
  const session = await svc.liveSession(decodeSession(jar.get(SESSION_COOKIE)?.value));
  return (
    <PageShell footer={false}>
      <OrganizerQueue organizers={group.organizers} initial={requests} session={session} roster={roster} policyVersion={group.policy.version} alerts={group.alerts} />
    </PageShell>
  );
}
