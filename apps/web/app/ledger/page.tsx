import type { Metadata } from 'next';
import { LedgerTable } from '@/components/ledger/LedgerTable';
import { PageShell, SimTag } from '@/components/PageShell';
import { services } from '@/lib/server/services';

export const metadata: Metadata = { title: 'Ledger', description: 'Every payout item, its PayPal status and whether it reconciles.' };
export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  const svc = services();
  const ledger = await svc.getLedger();
  return (
    <PageShell>
      <div className="mx-auto max-w-[1280px] px-4 pb-10 pt-12 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.95rem] text-ink-2">Eastside Mutual Aid · organizers only</p>
            <h1 className="mt-1 text-h2 text-ink">Ledger</h1>
          </div>
          {svc.modes.paypalMode !== 'sandbox' && <SimTag>PayPal: simulated ids</SimTag>}
        </div>
        <p className="mt-3 max-w-[68ch] text-ink-2">
          Every payout item we asked PayPal to send, what PayPal says happened to it, and whether it matches PayPal’s own records. Receivers are masked even here.
        </p>
        <LedgerTable initial={ledger} />
      </div>
    </PageShell>
  );
}
