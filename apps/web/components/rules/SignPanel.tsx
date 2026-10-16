'use client';

import { Check, Fingerprint, KeyRound, LoaderCircle, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { clockTime, cx, shortId } from '@/lib/format';
import { passkeyErrorMessage, signPolicyWithPasskey } from '@/lib/passkey-client';
import type { Organizer, OrganizerSession, PolicyDraftView, PolicySignResult } from '@/lib/types';

/** Step 3: two different organizers sign the draft hash. The second valid signature activates it. */
export function SignPanel({
  draft,
  session,
  organizers,
  demoMode,
  onSigned,
}: {
  draft: PolicyDraftView;
  session: OrganizerSession | null;
  organizers: Organizer[];
  demoMode: boolean;
  onSigned: (r: PolicySignResult) => void;
}) {
  const signedIds = new Set(draft.signatures.filter((s) => s.counts).map((s) => s.organizerId));
  const unsigned = organizers.filter((o) => !signedIds.has(o.id));
  const [demoAs, setDemoAs] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = draft.status === 'open';
  const slots = Array.from({ length: Math.max(draft.required, draft.signatures.length) }, (_, i) => draft.signatures[i] ?? null);
  const mine = session ? signedIds.has(session.organizerId) : false;
  const demoName = organizers.find((o) => o.id === demoAs)?.name;

  const run = async (fn: () => Promise<PolicySignResult>) => {
    setBusy(true);
    setError(null);
    try {
      onSigned(await fn());
      setDemoAs('');
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ol className="grid gap-3 sm:grid-cols-2" aria-label="Signatures">
        {slots.map((s, i) => (
          <li
            key={s?.organizerId ?? `empty-${i}`}
            className={cx('rounded-2xl p-4', s ? (s.counts ? 'bg-pine-wash text-pine' : 'border border-dashed border-signal bg-signal-wash/50 text-signal') : 'border border-dashed border-rule-strong text-ink-3')}
          >
            {s ? (
              <>
                <p className="flex items-center gap-2 font-semibold">
                  {s.counts ? <Check size={18} strokeWidth={2.6} aria-hidden /> : <ShieldOff size={18} aria-hidden />}
                  {s.name} signed
                </p>
                <p className="mt-1 text-[0.82rem] text-ink-2">
                  {s.kind === 'demo_key' ? 'Demo key held by this server' : `Passkey on ${s.deviceLabel}`}, {clockTime(s.at)}
                </p>
                {!s.counts && <p className="mt-1 text-[0.82rem]">That device was revoked, so this signature no longer counts.</p>}
              </>
            ) : (
              <p className="text-[0.92rem]">{i === 0 ? 'Waiting for a first organizer' : 'Waiting for a different organizer'}</p>
            )}
          </li>
        ))}
      </ol>

      {open && (
        <div className="mt-5">
          {session ? (
            <button
              type="button"
              disabled={busy || mine}
              onClick={() => void run(() => signPolicyWithPasskey({ draftHash: draft.draftHash, organizerId: session.organizerId }))}
              className="inline-flex h-13 items-center gap-2 rounded-full bg-ink px-6 font-semibold text-raised active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Fingerprint size={18} aria-hidden />}
              {mine ? 'You signed this draft' : `Sign Policy v${draft.version} as ${session.name}`}
            </button>
          ) : demoMode ? (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-wrap items-center gap-2 text-[0.92rem] text-ink-2">
                <KeyRound size={16} aria-hidden /> Sign with
                <select value={demoAs} onChange={(e) => setDemoAs(e.target.value)} className="h-11 rounded-full border border-rule-strong bg-paper px-4 text-[0.92rem] font-medium text-ink">
                  <option value="">choose a demo key</option>
                  {unsigned.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}’s demo key
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !demoAs}
                onClick={() => void run(() => api.signPolicy({ draftHash: draft.draftHash, organizerId: demoAs, signer: { kind: 'demo_key' } }))}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-raised active:scale-[0.98] disabled:opacity-50"
              >
                {busy && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
                {demoName ? `Sign as ${demoName}` : 'Sign'}
              </button>
            </div>
          ) : (
            <p className="text-[0.95rem] text-ink-2">
              <Link href="/organizer" className="font-semibold text-ink underline underline-offset-4">
                Sign in with your passkey
              </Link>{' '}
              to sign this draft.
            </p>
          )}
          <p className="mt-3 max-w-[60ch] text-[0.82rem] text-ink-3">
            {session
              ? 'Your device asks for Face ID, a fingerprint or your PIN, then signs this exact draft.'
              : demoMode
                ? 'Demo keys are held by this server and sign the same way, but no person unlocks them; the signature says “demo key”. Sign in on the organizer page to use a passkey.'
                : ''}{' '}
            The signature covers every rule, cap and sentence above (draft <span className="id-text">{shortId(draft.draftHash, 8, 6)}</span>). A different draft needs new signatures.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-[0.9rem] text-signal">
              {error}
            </p>
          )}
        </div>
      )}
      {draft.status === 'superseded' && <p className="mt-4 text-[0.92rem] text-ink-2">A newer draft replaced this one.</p>}
      {draft.status === 'stale' && <p className="mt-4 text-[0.92rem] text-ink-2">The active rules changed after this draft was made. Draft again from the current rules.</p>}
    </div>
  );
}
