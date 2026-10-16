import Link from 'next/link';
import { SITE } from '@/lib/site';
import { Wordmark } from './Wordmark';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-rule">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <Wordmark size="sm" />
          <p className="max-w-[40ch] text-[0.95rem] text-ink-2">
            A hotline, not a dashboard. Built for the {SITE.hackathon}. Open source under the MIT license.
          </p>
        </div>
        <nav aria-label="Product">
          <ul className="space-y-2 text-[0.95rem]">
            <li><Link className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href="/demo">Live demo</Link></li>
            <li><Link className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href="/call">Ask for help</Link></li>
            <li><Link className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href="/organizer">Organizer queue</Link></li>
            <li><Link className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href="/ledger">Ledger</Link></li>
          </ul>
        </nav>
        <nav aria-label="Accountability">
          <ul className="space-y-2 text-[0.95rem]">
            <li><Link className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href="/report">Transparency report</Link></li>
            <li><Link className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href="/trust">Trust &amp; compliance</Link></li>
            <li><a className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href={SITE.github}>Source on GitHub</a></li>
            <li><a className="text-ink-2 underline-offset-4 hover:text-ink hover:underline" href={SITE.threatModel}>Threat model</a></li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
