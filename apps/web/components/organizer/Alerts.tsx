import { CircleAlert, Scale } from 'lucide-react';
import { cx, money, shortDate } from '@/lib/format';
import type { OrganizerAlert } from '@/lib/types';

const KIND: Record<OrganizerAlert['kind'], { title: string; Icon: typeof CircleAlert; what: string }> = {
  unclaimed_day25: {
    title: 'Unclaimed for 25 days',
    Icon: CircleAlert,
    what: 'PayPal sends unclaimed money back to the group on day 30. Call or message the neighbor and help them claim it, or cancel it from the ledger.',
  },
  reconcile_mismatch: {
    title: 'Ledger doesn’t match PayPal',
    Icon: Scale,
    what: 'Our record of these payouts differs from PayPal’s Transaction Search. Check them in the ledger before approving more.',
  },
};

function daysLeft(deadline: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 86_400_000));
}

/**
 * Alerts raised by the background jobs (POST /api/internal/organizer-alert): things a person should
 * look at today. Shown on /organizer and /ledger; each links to its ledger rows.
 */
export function Alerts({
  alerts,
  items,
  className,
  linkToLedger = true,
}: {
  alerts: OrganizerAlert[] | undefined;
  /** ledger rows by item id, to name the amount (ledger page) */
  items?: Map<string, { requestRef: string; amountCents: number }>;
  className?: string;
  linkToLedger?: boolean;
}) {
  if (!alerts?.length) return null;
  return (
    <section aria-labelledby="alerts-h" className={cx('rounded-2xl border border-ink bg-raised', className)}>
      <h2 id="alerts-h" className="border-b border-rule px-4 py-3 font-sans text-[1rem] font-semibold tracking-normal text-ink sm:px-5">
        {alerts.length === 1 ? '1 thing needs a person' : `${alerts.length} things need a person`}
      </h2>
      <ul className="divide-y divide-rule">
        {alerts.map((a) => {
          const k = KIND[a.kind] ?? { title: a.kind, Icon: CircleAlert, what: '' };
          const named = items ? a.itemIds.map((id) => items.get(id)).filter((x): x is { requestRef: string; amountCents: number } => !!x) : [];
          const left = a.deadline ? daysLeft(a.deadline) : null;
          return (
            <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-4 sm:px-5">
              <k.Icon size={20} className={cx('mt-0.5', a.kind === 'reconcile_mismatch' ? 'text-signal' : 'text-ink')} aria-hidden />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <strong className="font-semibold text-ink">{k.title}</strong>
                  {a.deadline && (
                    <span className="rounded-full border border-ink px-2 py-0.5 text-[0.78rem] font-medium text-ink">
                      {left === 0 ? 'Returns today' : `${left} ${left === 1 ? 'day' : 'days'} left`}, returns {shortDate(a.deadline)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[0.95rem] text-ink">{a.summary}</p>
                <p className="mt-1 text-[0.85rem] text-ink-2">{k.what}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.85rem] text-ink-3">
                  <span>Raised {shortDate(a.createdAt)} by the scheduled check</span>
                  {named.length > 0 && <span>{named.map((n) => `${n.requestRef} (${money(n.amountCents)})`).join(', ')}</span>}
                  {linkToLedger && a.itemIds.length > 0 && (
                    <a href={`/ledger#item-${a.itemIds[0]}`} className="font-semibold text-ink underline underline-offset-4">
                      {a.itemIds.length === 1 ? 'Show the payout in the ledger' : `Show the ${a.itemIds.length} payouts in the ledger`}
                    </a>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
