import Link from 'next/link';
import { PageShell } from '@/components/PageShell';

export default function NotFound() {
  return (
    <PageShell footer={false}>
      <div className="mx-auto max-w-[640px] px-4 py-24 sm:px-8">
        <h1 className="text-h2 text-ink">This line doesn’t go anywhere.</h1>
        <p className="mt-4 text-lead text-ink-2">The page you asked for isn’t here. If you need help, the hotline is one tap away.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/call" className="inline-flex h-12 items-center rounded-full bg-ink px-6 font-semibold text-raised">Ask for help</Link>
          <Link href="/" className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold text-ink">Go to the home page</Link>
        </div>
      </div>
    </PageShell>
  );
}
