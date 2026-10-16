import type { Metadata } from 'next';
import { OrganizerQueue } from '@/components/organizer/OrganizerQueue';
import { PageShell } from '@/components/PageShell';
import { services } from '@/lib/server/services';

export const metadata: Metadata = { title: 'Organizer queue', description: 'Approve or decline requests. Every payout needs two organizers.' };
export const dynamic = 'force-dynamic';

export default async function OrganizerPage() {
  const svc = services();
  const [group, requests] = await Promise.all([svc.getGroup(), svc.listRequests()]);
  return (
    <PageShell footer={false}>
      <OrganizerQueue organizers={group.organizers} initial={requests} />
    </PageShell>
  );
}
