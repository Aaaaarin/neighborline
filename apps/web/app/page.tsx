import Link from 'next/link';
import { HeroPhone } from '@/components/HeroPhone';
import { PageShell } from '@/components/PageShell';
import { SCENARIOS } from '@/lib/server/fixtures/scenarios';
import * as tpl from '@/lib/server/fixtures/templates';
import type { ThreadView } from '@/lib/types';

const lan = SCENARIOS.lan;
const at = (min: number, sec: number) => new Date(Date.UTC(2026, 9, 4, 14, min, sec)).toISOString(); // 7:mm PDT
const paid = tpl.paid('vi', { amount: '$150', wallet: 'VENMO', receiver: '@lan-nguyen54', tx: '4B2C8F2073253B0E1' });

const heroThread: ThreadView = {
  requestId: 'hero',
  lang: 'vi',
  status: 'paid',
  itemStatus: 'SUCCESS',
  awaitingConfirmation: false,
  approvalsCount: 2,
  approvalsRequired: 2,
  messages: [
    { id: 'h1', at: at(41, 2), from: 'neighbor', kind: 'voice', lang: 'vi', text: lan.transcript, textEn: lan.transcriptEn, meta: { audioSeconds: 24 } },
    { id: 'h2', at: at(41, 9), from: 'line', kind: 'readback', lang: 'vi', text: lan.readback, textEn: lan.readbackEn },
    { id: 'h3', at: at(41, 14), from: 'neighbor', kind: 'text', lang: 'vi', text: 'Đúng rồi', textEn: 'Yes, that’s right' },
    {
      id: 'h4',
      at: at(42, 31),
      from: 'line',
      kind: 'paid',
      lang: 'vi',
      text: paid.text,
      textEn: paid.textEn,
      meta: { amountCents: 15_000, wallet: 'VENMO', receiver: '@lan-nguyen54', transactionId: '4B2C8F2073253B0E1' },
    },
  ],
};

const STORY: Array<{ t: string; title: string; body: string; lang?: string; quote?: string }> = [
  {
    t: '0:00',
    title: 'Mrs. Lan leaves a voice note',
    body: 'Power’s been out two days. She needs a space heater and groceries. She says it in Vietnamese, the way she’d leave a message for a friend.',
  },
  {
    t: '0:06',
    title: 'Neighborline reads it back to her',
    body: 'In Vietnamese, out loud if she wants. Nothing is filed until she says it’s right.',
    lang: 'vi',
    quote: 'Đúng rồi.',
  },
  {
    t: '0:10',
    title: 'The group’s own rules set the amount',
    body: 'Code, not AI, matches “utility outage” in the group’s policy: up to $150. The rule is quoted on the request.',
  },
  {
    t: '0:18',
    title: 'Two organizers approve from their phones',
    body: 'Dana and Marcus each see the request in English with the original attached, the rule, and the rail checks. Two people, two devices.',
  },
  {
    t: '0:26',
    title: 'PayPal Payouts sends it',
    body: 'One batch, idempotent by design. PayPal’s webhook comes back SUCCESS and we verify its signature.',
  },
  {
    t: '0:31',
    title: 'She hears back in her language',
    body: 'A message from a vetted template, in Vietnamese. If the money can’t be claimed, the callback explains how — Rosa’s did, in Spanish.',
    lang: 'vi',
    quote: 'Đã gửi $150 vào Venmo của bạn.',
  },
];

const REFUSALS = [
  {
    title: 'AI never decides who deserves help.',
    body: 'It transcribes, translates and drafts. Amounts come from the group’s written rules, computed by code. Two humans approve every payout.',
  },
  {
    title: 'The agent that talks to neighbors can’t move money.',
    body: 'Only a separate approval service holds PayPal credentials, and it acts only on a record signed by two different organizers.',
  },
  {
    title: 'We protect the rail, not suspect the person.',
    body: 'Lookalike organizer handles, reused destinations and instructions hidden in a message are stopped at the payout — no one gets a “fraud score”.',
  },
];

export default function Home() {
  return (
    <PageShell>
      <section className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-20 lg:pt-20">
        <div>
          <p className="text-[0.95rem] text-ink-2">A mutual-aid hotline for Eastside, and for anywhere after a storm</p>
          <h1 className="mt-5 max-w-[16ch] text-[2.6rem] leading-[1.06] text-ink sm:text-h1 lg:text-display lg:leading-[1.02]">
            Ask in your own language. Cash in about 90 seconds.
          </h1>
          <p className="mt-7 max-w-[56ch] text-lead text-ink-2">
            Leave a voice note in any language. Two neighbors approve from their phones, and PayPal sends the money to your PayPal or Venmo — then we call you back in your language. No app, no forms, no English required.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/demo" className="inline-flex h-13 items-center rounded-full bg-ink px-7 text-[1.05rem] font-semibold text-raised transition-transform active:scale-[0.98]">
              Try the hotline
            </Link>
            <Link href="/donate" className="inline-flex h-13 items-center rounded-full border border-ink/25 px-7 text-[1.05rem] font-semibold text-ink hover:bg-sunk">
              Donate
            </Link>
          </div>
          <p className="mt-5 text-[0.9rem] text-ink-3">
            The demo runs a real flow end to end on a PayPal stand-in. No microphone needed.
          </p>
        </div>
        <div className="mx-auto w-full max-w-[380px]">
          <HeroPhone thread={heroThread} />
        </div>
      </section>

      <section aria-labelledby="story" className="border-y border-rule bg-raised">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
          <div className="lg:sticky lg:top-10 lg:self-start">
            <h2 id="story" className="text-h3 text-ink sm:text-h2">
              The morning after the ice storm
            </h2>
            <p className="mt-5 max-w-[42ch] serif-copy text-ink-2">
              Eastside had no power for three days. This is one request, start to finish, timed from the voice note to the PayPal transaction id.
            </p>
            <Link href="/demo" className="mt-6 inline-flex min-h-11 items-center text-[1rem] font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
              Watch it happen live
            </Link>
          </div>
          <ol className="relative">
            {STORY.map((s, i) => (
              <li key={s.t} className="relative grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 pb-10 last:pb-0 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-5">
                <span className="pt-1 text-[1rem] font-semibold tabular text-ink-3">{s.t}</span>
                <div className="relative border-l border-rule pl-5 sm:pl-6">
                  <span aria-hidden className={`absolute -left-[6px] top-2.5 size-[11px] rounded-full ${i === STORY.length - 1 ? 'bg-lamp' : 'bg-ink'}`} />
                  <h3 className="text-[1.4rem] leading-snug text-ink">{s.title}</h3>
                  <p className="mt-2 max-w-[58ch] text-ink-2">{s.body}</p>
                  {s.quote && (
                    <p lang={s.lang} className="mt-3 inline-block rounded-2xl rounded-bl-md bg-frost px-4 py-2 text-[1.05rem] text-frost-ink">
                      {s.quote}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="refuse" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-8">
        <h2 id="refuse" className="max-w-[24ch] text-h3 text-ink sm:text-h2">
          What it will never do
        </h2>
        <ul className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-3">
          {REFUSALS.map((r) => (
            <li key={r.title} className="border-t-2 border-ink pt-5">
              <h3 className="text-[1.3rem] leading-snug text-ink">{r.title}</h3>
              <p className="mt-3 text-ink-2">{r.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10">
          <Link href="/trust" className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
            How we keep the money safe
          </Link>
        </p>
      </section>

      <section aria-labelledby="give" className="mx-auto max-w-[1200px] px-4 sm:px-8">
        <div className="grid gap-8 rounded-[28px] bg-ink px-6 py-12 text-raised sm:px-12 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h2 id="give" className="text-h3 text-raised">
              Every dollar is public. No names, ever.
            </h2>
            <p className="mt-4 max-w-[58ch] text-raised/80">
              Donations go to the group’s fiscal sponsor. Each payout appears in the transparency report with its PayPal transaction id — and without anything that could identify the neighbor.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/donate" className="inline-flex h-13 items-center rounded-full bg-raised px-7 font-semibold text-ink">
              Donate
            </Link>
            <Link href="/report" className="inline-flex h-13 items-center rounded-full border border-raised/35 px-7 font-semibold text-raised hover:bg-raised/10">
              Read the report
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
