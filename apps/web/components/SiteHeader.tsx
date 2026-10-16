'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '@/lib/site';
import { cx } from '@/lib/format';
import { Wordmark } from './Wordmark';

export function SiteHeader({ compact = false, lit = false }: { compact?: boolean; lit?: boolean }) {
  const path = usePathname();
  return (
    <header className={cx('border-b border-rule', compact ? 'bg-paper' : 'bg-paper')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-raised">
        Skip to content
      </a>
      <div className={cx('mx-auto flex items-center justify-between gap-6 px-4 sm:px-8', compact ? 'h-16 max-w-none' : 'h-18 max-w-[1200px]')}>
        <Link href="/" className="rounded-md" aria-label="Neighborline home">
          <Wordmark lit={lit} />
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => {
              const active = path === n.href;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'rounded-full px-3.5 py-2 text-[0.95rem] transition-colors',
                      active ? 'bg-ink text-raised' : 'text-ink-2 hover:bg-sunk hover:text-ink',
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <details className="relative md:hidden">
          <summary className="flex h-11 cursor-pointer list-none items-center rounded-full border border-rule px-4 text-[0.95rem] [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <nav aria-label="Main" className="absolute right-0 top-13 z-40 w-56 rounded-2xl border border-rule bg-raised p-2 shadow-lg">
            <ul>
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={path === n.href ? 'page' : undefined}
                    className="block rounded-xl px-3 py-3 text-ink aria-[current=page]:bg-sunk"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/ledger" className="block rounded-xl px-3 py-3 text-ink">
                  Ledger
                </Link>
              </li>
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}
