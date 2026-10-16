'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-24 sm:px-8">
      <h1 className="text-h2 text-ink">Something on our side stopped working.</h1>
      <p className="mt-4 text-lead text-ink-2">No money moved because of this error. Try again — if it keeps happening, the demo server may be restarting.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="inline-flex h-12 items-center rounded-full bg-ink px-6 font-semibold text-raised">Try again</button>
        <Link href="/" className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold text-ink">Go to the home page</Link>
      </div>
    </main>
  );
}
