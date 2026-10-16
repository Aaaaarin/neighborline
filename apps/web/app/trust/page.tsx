import { Check, KeyRound, Lock, MoveDown } from 'lucide-react';
import type { Metadata } from 'next';
import { PageShell, SimTag } from '@/components/PageShell';
import { cx, money } from '@/lib/format';
import { services } from '@/lib/server/services';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Trust & compliance',
  description: 'Fiscal sponsor checks, which agent can do what, our principles, privacy, and what is simulated in the sandbox.',
};
export const dynamic = 'force-dynamic';

const PRINCIPLES = [
  ['AI never decides who deserves help.', 'No need scores and no fraud scores on people. AI transcribes, translates, pulls out the facts, cites the rule and drafts messages. Code computes every amount from the versioned policy. Two humans approve every payout.'],
  ['The intake agent cannot move money.', 'Only the approval service — a separate process — holds PayPal Payouts credentials, and it executes only a two-person approval record whose passkey signatures it checks itself. Least privilege, the same “authorize twice” idea PayPal uses for agent tools.'],
  ['Every AI output is checked against a schema.', 'Validate, repair once, and if it’s still unclear, ask the neighbor again in their language instead of guessing.'],
  ['Protect the rail, not suspect the person.', 'We block lookalike organizer handles, one payout destination used under different names, velocity and cap violations, and instructions hidden in a request.'],
  ['Money is idempotent.', 'The batch id is a hash of the approval record, so retries and double taps return the original batch. Every webhook is signature-checked, and a nightly reconcile against PayPal Transaction Search is scheduled on Render.'],
  ['Private by default.', 'Audio is deleted after transcription, personal details are redacted from logs, the public report is aggregate-only, and Venmo payouts are posted privately.'],
  ['Honest about the sandbox.', 'Anything we simulate is labelled where you see it, and listed below.'],
] as const;

export default async function TrustPage() {
  const trust = await services().getTrust();
  const g = trust.group;
  return (
    <PageShell>
      <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-12 sm:px-8 lg:pt-16">
        <header className="max-w-[760px]">
          <h1 className="text-h2 text-ink sm:text-h1">Trust &amp; compliance</h1>
          <p className="mt-5 serif-copy text-ink-2">
            Neighborline moves donated money to people in a crisis. Here is who holds it, which software is allowed to touch it, and what we still simulate.
          </p>
        </header>

        {/* Fiscal sponsor */}
        <section aria-labelledby="sponsor" className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <h2 id="sponsor" className="text-h4 text-ink">
              The money is held by a fiscal sponsor
            </h2>
            <p className="mt-3 text-ink-2">
              {g.fiscalSponsor.name} holds {g.name}’s funds in a PayPal Business account and is accountable for them. Volunteers never hold donations personally.
            </p>
          </div>
          <ul className="divide-y divide-rule border-y border-rule">
            {g.fiscalSponsor.checks.map((c) => (
              <li key={c.key} className="flex gap-4 py-4">
                <span className={cx('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', c.ok ? 'bg-pine text-raised' : 'bg-signal text-raised')} aria-hidden>
                  <Check size={16} strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-ink">
                    {c.label}
                    <span className="sr-only">{c.ok ? ': done' : ': not done'}</span>
                    {c.simulated && <SimTag />}
                  </p>
                  <p className="mt-1 text-[0.95rem] text-ink-2">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Know your agent */}
        <section aria-labelledby="kya" className="mt-20">
          <h2 id="kya" className="text-h4 text-ink">
            Know your agent: who can do what
          </h2>
          <p className="mt-2 max-w-[68ch] text-ink-2">
            The AI agents that talk to neighbors have no way to send money. The one service that can send money has no AI in it, and won’t act without two people.
          </p>
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-[24px] border-2 border-dashed border-rule-strong p-5 sm:p-6">
              <p className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink">
                <Lock size={18} aria-hidden /> Cannot move money
              </p>
              <ul className="mt-4 space-y-3">
                <Node title="Intake agent" body="Transcribes, translates, extracts the request, reads it back to the neighbor." tools={['speech-to-text', 'translate', 'extract (schema-checked)', 'read back']} none="No PayPal credentials. No payout tools." />
                <Node title="Notify agent" body="Tells the neighbor what happened, in their language, from vetted templates." tools={['fill template slots', 'send message']} none="No PayPal credentials. Can’t change amounts or destinations." />
                <Node title="Report writer" body="Writes the transparency report around figures that code inserts from the ledger." tools={['read aggregate rows']} none="Never sees names or payout destinations." />
              </ul>
            </div>
            <ol className="space-y-2">
              <Step title="Request record" body="Validated against a schema. Instructions inside a message are treated as text, never followed." />
              <Arrow />
              <Step title="Policy engine (code)" body={`Computes the amount from Policy v${g.policy.version}: the smallest of what was asked, the category limit, the household’s monthly limit (${money(g.policy.householdCapPer30dCents)}) and today’s budget.`} />
              <Arrow />
              <Step
                title="Two organizers sign, each with their own passkey"
                body={`Any two of ${g.organizers.map((o) => o.name).join(', ')}. Each tap is a WebAuthn signature over the approval hash: the exact requests, amounts, destinations and policy version. The approver is whoever owns the key, so one person tapping twice counts once.`}
              />
              <Arrow />
              <li className="rounded-2xl bg-ink p-5 text-raised">
                <p className="flex items-center gap-2 font-semibold">
                  <KeyRound size={18} aria-hidden /> Approval service — a separate process, the only one with PayPal Payouts credentials
                </p>
                <p className="mt-1.5 text-[0.95rem] text-raised/80">
                  Re-reads the requests, recomputes the approval hash and the amounts, and re-verifies both organizers’ signatures before it pays. The batch id is a hash of the approval record, so a retry can never pay twice. A blocked destination never reaches PayPal.
                </p>
              </li>
              <Arrow />
              <Step title="PayPal Payouts → signed webhook" body="Item status comes only from PayPal webhooks whose signatures we verify, then the notify agent tells the neighbor." />
            </ol>
          </div>
        </section>

        {/* Passkeys */}
        <section aria-labelledby="passkeys" className="mt-20 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <h2 id="passkeys" className="text-h4 text-ink">
              “Two different people” is a signature, not a promise
            </h2>
            <p className="mt-3 text-ink-2">
              Every organizer enrolls a passkey on their own phone or laptop. Approving a payout asks the device for Face ID, a fingerprint or the screen lock, and signs the approval hash. The signatures are stored with the approval and checked again by the approval service before PayPal is called.
            </p>
          </div>
          <dl className="divide-y divide-rule border-y border-rule">
            {[
              ['What is signed', 'The approval hash: SHA-256 over the request ids, each amount, wallet and receiver, and the policy version. Change any of it and the signature no longer matches.'],
              ['Who signed', 'The owner of the key, read from our database, never from the request. A key can belong to one organizer only. The card shows it as “Signed with passkey · Dana’s iPhone”.'],
              ['Joining as an organizer', 'A new organizer needs an invite code from an existing one to enroll their first passkey. Only the public half of the key is stored.'],
              ['Lost a phone', 'Any signed-in organizer can revoke a passkey on the organizer page. From then on it can’t sign in, approve or sign rules, and the approval service refuses approvals it signed that aren’t paid yet. The audit log records who revoked it.'],
              ['Changing the rules', 'The AI drafts new rules from the organizers’ own words, quoting the sentence behind every cap. A new policy version goes live only when two different organizers sign the hash of that exact draft; code then re-prices requests still waiting.'],
              [
                'In this demo',
                'Dana, Marcus and Priya are fictional, so the scripted taps are signed with server-held demo keys. They sign the same way, but no person unlocks them, and every card they sign says “demo key”. When you approve as Marcus, your own device signs with a real passkey if it has one.',
              ],
            ].map(([k, v]) => (
              <div key={k} className="py-4">
                <dt className="font-semibold text-ink">{k}</dt>
                <dd className="mt-1 text-[0.95rem] text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Principles */}
        <section aria-labelledby="principles" className="mt-20">
          <h2 id="principles" className="text-h4 text-ink">
            Principles we hold ourselves to
          </h2>
          <ul className="mt-6 grid gap-x-12 gap-y-8 md:grid-cols-2">
            {PRINCIPLES.map(([h, b]) => (
              <li key={h} className="border-t-2 border-ink pt-4">
                <h3 className="text-[1.25rem] leading-snug text-ink">{h}</h3>
                <p className="mt-2 text-ink-2">{b}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Privacy + sandbox */}
        <div className="mt-20 grid gap-10 lg:grid-cols-2">
          <section aria-labelledby="privacy">
            <h2 id="privacy" className="text-h4 text-ink">
              Privacy
            </h2>
            <ul className="mt-5 space-y-4 text-ink-2">
              <li><strong className="font-semibold text-ink">Voice notes are deleted</strong> as soon as they’re transcribed. Only the text and the read-back the neighbor confirmed are kept.</li>
              <li><strong className="font-semibold text-ink">Logs are redacted.</strong> Phone numbers, emails and handles are masked before anything is written to a log.</li>
              <li><strong className="font-semibold text-ink">Organizers see first names</strong> and a neighborhood: enough to recognise a neighbor, no more.</li>
              <li><strong className="font-semibold text-ink">The public report is aggregate-only.</strong> Groups of fewer than 5 people are hidden or merged, so nobody on a small street can be picked out; payout lines never show language, name or place.</li>
              <li><strong className="font-semibold text-ink">Venmo payouts are private</strong> (social feed privacy set to PRIVATE), so a neighbor’s need never appears in a feed.</li>
            </ul>
          </section>
          <section aria-labelledby="sandbox" className="rounded-[24px] border-2 border-dashed border-rule-strong p-5 sm:p-7">
            <h2 id="sandbox" className="text-h4 text-ink">
              Sandbox reality
            </h2>
            <p className="mt-2 text-[0.95rem] text-ink-2">
              Running in <strong className="text-ink">{trust.modes.paypalMode === 'sandbox' ? 'PayPal sandbox' : trust.modes.paypalMode === 'fake' ? 'local fake PayPal' : 'offline demo'}</strong> mode with <strong className="text-ink">{trust.modes.aiMode === 'live' ? 'live AI' : 'fixture AI'}</strong>.
            </p>
            <ul className="mt-5 space-y-4">
              {trust.sandboxReality.map((s) => (
                <li key={s.label}>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-ink">
                    {s.label}
                    <span
                      className={cx(
                        'rounded-full px-2 py-0.5 text-[0.75rem] font-medium',
                        s.status === 'real' ? 'bg-pine-wash text-pine' : s.status === 'simulated' ? 'border border-dashed border-rule-strong text-ink-2' : 'bg-sunk text-ink-2',
                      )}
                    >
                      {s.status === 'real' ? 'Real (sandbox)' : s.status === 'simulated' ? 'Simulated' : 'Not yet'}
                    </span>
                  </p>
                  <p className="mt-1 text-[0.92rem] text-ink-2">{s.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="mt-14 border-t border-rule pt-6 text-ink-2">
          The full threat model — impersonation, prompt injection, replayed webhooks, insider abuse — lives in{' '}
          <a href={SITE.threatModel} className="font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] hover:decoration-ink">
            THREAT_MODEL.md
          </a>
          .
        </p>
      </div>
    </PageShell>
  );
}

function Node({ title, body, tools, none }: { title: string; body: string; tools: string[]; none: string }) {
  return (
    <li className="rounded-2xl border border-rule bg-raised p-4">
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[0.92rem] text-ink-2">{body}</p>
      <p className="mt-2 flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <span key={t} className="rounded-full bg-frost px-2 py-0.5 text-[0.75rem] text-frost-ink">
            {t}
          </span>
        ))}
      </p>
      <p className="mt-2 text-[0.85rem] font-medium text-ink">{none}</p>
    </li>
  );
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <li className="rounded-2xl border border-rule bg-raised p-4">
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[0.92rem] text-ink-2">{body}</p>
    </li>
  );
}

function Arrow() {
  return (
    <li aria-hidden className="flex justify-center text-ink-3">
      <MoveDown size={20} />
    </li>
  );
}
