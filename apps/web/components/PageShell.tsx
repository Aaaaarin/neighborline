import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function PageShell({ children, footer = true }: { children: React.ReactNode; footer?: boolean }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      {footer && <SiteFooter />}
    </>
  );
}

/** Sandbox / simulation tag — always words, never colour alone. */
export function SimTag({ children = 'Sandbox: simulated' }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-rule-strong px-2 py-0.5 text-[0.75rem] font-medium text-ink-2">
      {children}
    </span>
  );
}
