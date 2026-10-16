import type { Metadata } from 'next';
import Link from 'next/link';
import { DonateForm } from '@/components/donate/DonateForm';
import { PageShell } from '@/components/PageShell';
import { duration, money } from '@/lib/format';
import { services } from '@/lib/server/services';

export const metadata: Metadata = { title: 'Donate', description: 'Give once or monthly with PayPal, Venmo or Pay Later. See exactly where the money goes.' };
export const dynamic = 'force-dynamic';

const FLOW = [
  {
    title: 'You give through PayPal',
    body: 'Cascadia Community Fund, Eastside’s fiscal sponsor, receives it and emails your tax receipt.',
  },
  {
    title: 'It waits in the sponsor’s PayPal Business account',
    body: 'Earmarked for Eastside Mutual Aid. No volunteer holds the money personally.',
  },
  {
    title: 'A neighbor asks, in any language',
    body: 'The group’s written rules — public on this site — set the amount. Code applies them; AI never decides who deserves help.',
  },
  {
    title: 'Two organizers approve, on two phones',
    body: 'Only then can the approval service send a PayPal Payout, tagged as a donation, to the neighbor’s PayPal or Venmo.',
  },
  {
    title: 'It shows up in the public report',
    body: 'Every payout is listed with its PayPal transaction id — and nothing that could identify the neighbor.',
  },
];

export default async function DonatePage() {
  const report = await services().getReport();
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || null;
  return (
    <PageShell>
      <div className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-14 px-4 pb-10 pt-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20 lg:pt-16">
        <div>
          <h1 className="max-w-[14ch] text-h2 text-ink sm:text-h1">Keep the line warm.</h1>
          <p className="mt-5 max-w-[50ch] text-lead text-ink-2">
            Since the ice storm, Eastside neighbors have received {money(report.totals.paidCents)}. Half of them had the money within {duration(report.totals.medianSecondsToCash)} of asking. Your gift is the next one.
          </p>
          <div className="mt-9">
            <DonateForm clientId={clientId} />
          </div>
        </div>
        <section aria-labelledby="flow" className="lg:pt-4">
          <h2 id="flow" className="text-h4 text-ink">
            Exactly how your money moves
          </h2>
          <ol className="mt-6">
            {FLOW.map((f, i) => (
              <li key={f.title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 border-t border-rule py-5">
                <span className="grid size-9 place-items-center rounded-full border border-ink/30 text-[0.95rem] font-semibold tabular text-ink">{i + 1}</span>
                <div>
                  <h3 className="font-sans text-[1.05rem] font-semibold tracking-normal text-ink">{f.title}</h3>
                  <p className="mt-1 text-ink-2">{f.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-rule pt-6">
            <div>
              <dt className="text-[0.88rem] text-ink-3">Given since the storm</dt>
              <dd className="mt-1 text-[1.6rem] font-semibold text-ink">{money(report.totals.donationsCents)}</dd>
            </div>
            <div>
              <dt className="text-[0.88rem] text-ink-3">Donors</dt>
              <dd className="mt-1 text-[1.6rem] font-semibold text-ink">{report.totals.donors}</dd>
            </div>
          </dl>
          <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/report" className="font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
              Read the transparency report
            </Link>
            <Link href="/trust" className="font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
              Trust &amp; compliance
            </Link>
          </p>
        </section>
      </div>
    </PageShell>
  );
}
