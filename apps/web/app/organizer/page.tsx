import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { OrganizerQueue } from '@/components/organizer/OrganizerQueue';
import { PageShell } from '@/components/PageShell';
import { viewsFor } from '@/lib/server/security/redact';
import { viewerFromCookies } from '@/lib/server/security/viewer';
import { services } from '@/lib/server/services';

export const metadata: Metadata = { title: 'Organizer queue', description: 'Approve or decline requests. Every payout needs two organizers, each signing with a passkey.' };
export const dynamic = 'force-dynamic';

export default async function OrganizerPage() {
  const svc = services();
  const [group, requests, roster, jar] = await Promise.all([svc.getGroup(), svc.listRequests(), svc.passkeyRoster(), cookies()]);
  // Same scoping as GET /api/requests: full for organizers and the visitor's own runs, redacted otherwise.
  const viewer = await viewerFromCookies(jar);
  const session = viewer.organizer;
  return (
    <PageShell footer={false}>
      <OrganizerQueue organizers={group.organizers} initial={viewsFor(viewer, requests)} session={session} roster={roster} policyVersion={group.policy.version} alerts={group.alerts} rail={group.rail} />
    </PageShell>
  );
}
