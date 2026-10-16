import type { Metadata } from 'next';
import Link from 'next/link';
import { CallApp } from '@/components/call/CallApp';
import { Wordmark } from '@/components/Wordmark';
import { services } from '@/lib/server/services';
import { displayNumber, hotlineNumber } from '@/lib/server/voice/config';

export const metadata: Metadata = {
  title: 'Ask for help',
  description: 'Leave a voice note in any language. Two neighbors approve, and the money goes to your PayPal or Venmo.',
};

export default function CallPage() {
  const samples = services().listSampleVoiceNotes();
  // Shown only when this server has a Twilio number (docs/PHONE.md); otherwise nothing renders.
  const hotline = hotlineNumber();
  return (
    <div className="min-h-dvh lg:mx-auto lg:grid lg:max-w-[1100px] lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:gap-20 lg:px-8 lg:py-10">
      <aside className="hidden lg:block">
        <Link href="/" className="rounded-md" aria-label="Neighborline home">
          <Wordmark />
        </Link>
        <h2 className="mt-10 max-w-[18ch] text-h2 text-ink">This is what a neighbor sees.</h2>
        <p className="mt-5 max-w-[46ch] serif-copy text-ink-2">
          One screen, one big button. Talk in any language, or type, or add a photo. Neighborline reads it back before anything is filed, then keeps you posted in your own language until the money lands.
        </p>
        <ul className="mt-8 space-y-3 text-ink-2">
          <li>No account, no app, no English required.</li>
          <li>Press and hold to talk, or tap once to start and once to stop.</li>
          <li>No microphone? Use one of the sample voice notes.</li>
        </ul>
        {hotline && (
          <section aria-labelledby="hotline" className="mt-8 max-w-[46ch] rounded-2xl border border-rule bg-raised p-4">
            <h3 id="hotline" className="font-semibold text-ink">
              Call the hotline
            </h3>
            <p className="mt-1 text-ink-2">
              Any phone works. Call{' '}
              <a href={`tel:${hotline}`} className="font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
                {displayNumber(hotline)}
              </a>
              , say what you need in any language, and press 1 when we read it back. We call you back when the money is sent.
            </p>
          </section>
        )}
        <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/organizer" className="font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
            Open the organizer queue
          </Link>
          <Link href="/demo" className="font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
            Watch the full demo
          </Link>
        </p>
      </aside>
      <main id="main" className="flex h-dvh flex-col bg-screen lg:h-auto lg:bg-transparent">
        <div className="flex min-h-0 flex-1 flex-col lg:aspect-[9/18.7] lg:w-[400px] lg:flex-none lg:rounded-[52px] lg:bg-device lg:p-[9px] lg:shadow-device">
          <div className="flex min-h-0 flex-1 flex-col bg-screen pt-[env(safe-area-inset-top)] lg:overflow-hidden lg:rounded-[43px] lg:pt-11">
            <CallApp samples={samples} />
          </div>
        </div>
      </main>
    </div>
  );
}
