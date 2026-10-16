import { Check, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { PageShell } from '@/components/PageShell';
import { Bars, ChartFrame, Columns, Dots } from '@/components/report/Charts';
import { duration, money, shortDate, shortId } from '@/lib/format';
import { services } from '@/lib/server/services';

export const metadata: Metadata = {
  title: 'Transparency report',
  description: 'Where every dollar went after the ice storm — aggregate only, every figure checked against the PayPal ledger.',
};
export const dynamic = 'force-dynamic';

const txUrl = (id: string) => `https://www.sandbox.paypal.com/activity/payment/${encodeURIComponent(id)}`;

export default async function ReportPage() {
  const svc = services();
  const r = await svc.getReport();
  const sandbox = svc.modes.paypalMode === 'sandbox';
  const demo = process.env.DEMO_MODE !== 'false';
  const t = r.totals;
  const medianBucket = r.timeToCash.findIndex((b) => t.medianSecondsToCash >= b.fromSec && (b.toSec === null || t.medianSecondsToCash < b.toSec));
  const overallApproval =
    Math.round(
      (r.approvalParity.reduce((s, p) => s + p.medianMinutesToApproval * p.n, 0) / Math.max(1, r.approvalParity.reduce((s, p) => s + p.n, 0))) * 10,
    ) / 10;
  const linesShown = r.lines.slice(0, 12);
  const linesMore = r.lines.slice(12);
  const unclaimed = r.lines.filter((l) => l.status === 'UNCLAIMED').length;

  return (
    <PageShell>
      <article className="mx-auto max-w-[1100px] px-4 pb-10 pt-12 sm:px-8 lg:pt-16">
        <header className="max-w-[760px]">
          <p className="text-[0.95rem] text-ink-2">Eastside Mutual Aid · {r.period.label}</p>
          <h1 className="mt-2 text-h2 text-ink sm:text-h1">Where the money went</h1>
          {demo && (
            <p className="mt-4 max-w-[62ch] rounded-2xl border-2 border-dashed border-rule-strong px-4 py-3 text-[0.92rem] text-ink-2">
              <strong className="font-semibold text-ink">Demo data.</strong> The neighbors, donors and four weeks of history are fictional, seeded for this demo; runs you start on the live demo are added as they happen. Every figure is still computed from the database rows, the same way it would be for a real group.
            </p>
          )}
          <p className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-full bg-pine-wash py-1.5 pl-2 pr-4 text-[0.9rem] font-medium text-pine">
            <span className="grid size-6 place-items-center rounded-full bg-pine text-raised" aria-hidden>
              <Check size={14} strokeWidth={3} />
            </span>
            Every number checked against the ledger · {r.narrative.figuresChecked} figures
          </p>
        </header>

        <section aria-label="Summary" className="mt-10 max-w-[68ch] space-y-5">
          {r.narrative.paragraphs.map((p, i) => (
            <p key={i} className="serif-copy text-ink">
              {p.map((seg, j) =>
                typeof seg === 'string' ? (
                  <span key={j}>{seg}</span>
                ) : (
                  <span key={j} className="font-semibold underline decoration-pine/50 decoration-dotted decoration-2 underline-offset-[5px]" title={`Checked against the ledger (${seg.ref})`}>
                    {seg.figure}
                  </span>
                ),
              )}
            </p>
          ))}
          <p className="text-[0.85rem] text-ink-3">
            Written by the {r.narrative.writtenBy.toLowerCase()}. Underlined figures are inserted by code from the ledger, not written by the model.
          </p>
        </section>

        <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-rule py-7 md:grid-cols-4">
          {[
            ['Sent to neighbors', money(t.paidCents)],
            ['Households helped', String(t.households)],
            ['Median, request to cash (incl. approvals)', duration(t.medianSecondsToCash)],
            ['Unclaimed, then rescued', t.unclaimedMasked ? `Fewer than ${r.kAnonymity.k}` : `${t.unclaimedRescued} of ${t.unclaimedTotal}`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[0.9rem] text-ink-2">{k}</dt>
              <dd className="mt-1 text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 grid gap-x-14 gap-y-12 lg:grid-cols-2">
          <ChartFrame
            id="ttc"
            title="Time from voice note to cash"
            subtitle={`Payouts by how long they took · median ${duration(t.medianSecondsToCash)}, 90% within ${duration(t.p90SecondsToCash)}`}
            table={{ head: ['Time to cash', 'Payouts'], rows: r.timeToCash.map((b) => [b.label, b.count]) }}
          >
            <Columns data={r.timeToCash.map((b) => ({ label: b.label, value: b.count, hint: `${b.label}: ${b.count} payouts` }))} emphasize={medianBucket} />
            <p className="mt-3 text-[0.82rem] text-ink-3">The long tail is unclaimed PayPal payouts: the clock keeps running until the neighbor claims.</p>
          </ChartFrame>

          <ChartFrame
            id="lang"
            title="By language"
            subtitle="Money sent, and households, by the language they asked in"
            table={{ head: ['Language', 'Households', 'Sent'], rows: r.byLanguage.map((l) => [l.label, l.households, money(l.paidCents)]) }}
          >
            <Bars data={r.byLanguage.map((l) => ({ label: l.label, value: l.paidCents, display: money(l.paidCents), note: `${l.households} households` }))} />
          </ChartFrame>

          <ChartFrame
            id="cat"
            title="By need"
            subtitle="By rule category"
            table={{ head: ['Category', 'Payouts', 'Sent'], rows: r.byCategory.map((c) => [c.label, c.payouts, money(c.paidCents)]) }}
          >
            <Bars data={r.byCategory.map((c) => ({ label: c.label, value: c.paidCents, display: money(c.paidCents), note: `${c.payouts} payouts` }))} />
          </ChartFrame>

          <ChartFrame
            id="parity"
            title="Are approvals fair across languages?"
            subtitle="Median minutes to a second approval, and share of requests approved"
            table={{
              head: ['Language', 'Requests', 'Median minutes', 'Approved'],
              rows: r.approvalParity.map((p) => [p.label, p.n, p.medianMinutesToApproval, `${Math.round(p.approvalRate * 100)}%`]),
            }}
          >
            <Dots
              data={r.approvalParity.map((p) => ({ label: p.label, value: p.medianMinutesToApproval, right: `${Math.round(p.approvalRate * 100)}%` }))}
              reference={{ value: overallApproval, label: `All: ${overallApproval} min` }}
              unit="minutes to second approval"
            />
          </ChartFrame>
        </div>

        <aside className="mt-14 rounded-2xl border border-rule bg-raised p-5 sm:p-6" aria-labelledby="kanon">
          <h2 id="kanon" className="font-sans text-[1.05rem] font-semibold tracking-normal text-ink">
            Why there are no names here
          </h2>
          <p className="mt-1.5 max-w-[72ch] text-ink-2">{r.kAnonymity.note}</p>
        </aside>

        <section aria-labelledby="lines" className="mt-14">
          <h2 id="lines" className="text-h4 text-ink">
            Every payout
          </h2>
          <p className="mt-1 text-ink-2">
            {r.lines.length} payouts sent{unclaimed ? `, ${unclaimed} still waiting to be claimed` : ''}. Date, need and amount only.{' '}
            {sandbox ? 'Each paid line links to its PayPal sandbox transaction.' : 'Transaction ids come from the local PayPal stand-in, so they are not linked.'}
          </p>
          <PayoutTable lines={linesShown} link={sandbox} />
          {linesMore.length > 0 && (
            <details className="group">
              <summary className="mt-3 inline-flex min-h-11 cursor-pointer list-none items-center font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show all {r.lines.length} payouts</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <PayoutTable lines={linesMore} link={sandbox} />
            </details>
          )}
        </section>
      </article>
    </PageShell>
  );
}

function PayoutTable({ lines, link }: { lines: Awaited<ReturnType<ReturnType<typeof services>['getReport']>>['lines']; link: boolean }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg" tabIndex={0} role="region" aria-label="Payouts with PayPal transaction ids, scrolls sideways on small screens">
      <table className="w-full min-w-[520px] text-[0.95rem]">
        <thead>
          <tr className="border-b border-rule-strong text-left text-[0.85rem] text-ink-3">
            <th scope="col" className="py-2 pr-4 font-medium">Date</th>
            <th scope="col" className="py-2 pr-4 font-medium">Need</th>
            <th scope="col" className="py-2 text-right font-medium">Amount</th>
            <th scope="col" className="py-2 pl-6 font-medium">PayPal transaction</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.transactionId}-${i}`} className="border-b border-rule">
              <td className="whitespace-nowrap py-2.5 pr-4 tabular text-ink-2">{shortDate(l.date)}</td>
              <td className="py-2.5 pr-4 text-ink">{l.categoryLabel}</td>
              <td className="py-2.5 text-right tabular text-ink">{money(l.amountCents)}</td>
              <td className="py-2.5 pl-6">
                {l.status === 'SUCCESS' && l.transactionId && !link ? (
                  <span className="id-text text-ink-2" title={l.transactionId}>
                    {shortId(l.transactionId, 6, 4)}
                  </span>
                ) : l.status === 'SUCCESS' && l.transactionId ? (
                  <a href={txUrl(l.transactionId)} className="inline-flex items-center gap-1.5 text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink" aria-label={`PayPal transaction ${l.transactionId}`}>
                    <span className="id-text">{shortId(l.transactionId, 6, 4)}</span>
                    <ExternalLink size={13} aria-hidden className="text-ink-3" />
                  </a>
                ) : (
                  <span className="text-[0.88rem] text-ink-2">Unclaimed · waiting for the neighbor</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
