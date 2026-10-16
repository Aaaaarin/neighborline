'use client';

import { Fingerprint, KeyRound, LoaderCircle, LogOut } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { cx } from '@/lib/format';
import { enrollPasskey, guessDeviceLabel, passkeyErrorMessage, passkeysAvailable, signInWithPasskey } from '@/lib/passkey-client';
import type { Organizer, OrganizerSession, PasskeyRoster } from '@/lib/types';

/** Signed in: who you are and which device signs your approvals. */
export function SignedInBar({ session, onSignedOut }: { session: OrganizerSession; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-pine-wash px-4 py-3 text-pine">
      <p className="flex items-center gap-2 text-[0.92rem]">
        <Fingerprint size={18} aria-hidden />
        <span>
          Signed in as <strong className="font-semibold">{session.name}</strong>. Each approval is signed by the passkey on {session.deviceLabel}.
        </span>
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api.signOut().catch(() => {});
          onSignedOut();
        }}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[0.88rem] font-medium hover:bg-raised/60"
      >
        <LogOut size={16} aria-hidden /> Sign out
      </button>
    </div>
  );
}

/**
 * Signed out: sign in with a passkey, or (first run) create one with an invite code. In DEMO_MODE a
 * visitor can also act as Marcus with his labelled demo key, on their own runs only (the server
 * refuses anything else), so one visitor can never be two organizers.
 */
export function SignInPanel({
  organizers,
  roster,
  demoAs,
  onDemoAs,
  onSession,
}: {
  organizers: Organizer[];
  roster: PasskeyRoster;
  demoAs: string | null;
  onDemoAs: (id: string | null) => void;
  onSession: (s: OrganizerSession) => void;
}) {
  const [mode, setMode] = useState<'signin' | 'setup'>('signin');
  const [supported, setSupported] = useState<boolean | null>(null);
  const [who, setWho] = useState(organizers[0]?.id ?? '');
  const name = organizers.find((o) => o.id === who)?.name ?? '';
  const [label, setLabel] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  useEffect(() => {
    void passkeysAvailable().then(setSupported);
  }, []);
  useEffect(() => {
    setLabel(guessDeviceLabel(name));
  }, [name]);

  const run = async (fn: () => Promise<OrganizerSession>) => {
    setBusy(true);
    setError(null);
    try {
      onSession(await fn());
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const count = (id: string) => roster.organizers.find((o) => o.id === id)?.passkeys.length ?? 0;

  return (
    <section aria-labelledby={`${ids}-h`} className="mt-6 rounded-2xl border border-rule bg-raised p-5 sm:p-6">
      <h2 id={`${ids}-h`} className="text-[1.35rem] leading-tight text-ink">
        {mode === 'signin' ? 'Sign in to approve' : 'Set up your passkey'}
      </h2>
      <p className="mt-1.5 max-w-[56ch] text-[0.92rem] text-ink-2">
        {mode === 'signin'
          ? 'Approvals are signed by a passkey on your own phone or laptop: Face ID, a fingerprint or your screen lock. Nobody can approve as you without it, and the signature covers the exact amount and destination.'
          : 'Your device makes a key pair. The private half never leaves it; we keep only the public half to check your signatures.'}
      </p>
      {supported === false && (
        <p className="mt-3 rounded-xl bg-sunk px-3 py-2 text-[0.85rem] text-ink-2">This browser can’t use a built-in passkey. Try your phone, or a browser with Face ID, Touch ID or Windows Hello.</p>
      )}

      {mode === 'signin' ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(signInWithPasskey)}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-raised active:scale-[0.98] disabled:opacity-70"
          >
            {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Fingerprint size={18} aria-hidden />}
            Sign in with passkey
          </button>
          <button type="button" onClick={() => setMode('setup')} className="min-h-11 px-2 text-[0.92rem] text-ink-2 underline underline-offset-4 hover:text-ink">
            First time here? Set up a passkey
          </button>
        </div>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => enrollPasskey({ organizerId: who, deviceLabel: label, ...(invite.trim() ? { inviteCode: invite.trim() } : {}) }));
          }}
        >
          <fieldset>
            <legend className="text-[0.9rem] font-semibold text-ink">I am</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {organizers.map((o) => (
                <label key={o.id} className={cx('flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[0.95rem]', who === o.id ? 'border-ink bg-sunk text-ink' : 'border-rule text-ink-2')}>
                  <input type="radio" name={`${ids}-who`} value={o.id} checked={who === o.id} onChange={() => setWho(o.id)} className="size-4 accent-[var(--ink)]" />
                  {o.name}
                  {count(o.id) > 0 && <span className="text-[0.78rem] text-ink-3">{count(o.id) === 1 ? '1 passkey' : `${count(o.id)} passkeys`}</span>}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${ids}-label`} className="text-[0.9rem] font-semibold text-ink">
              Name this device
            </label>
            <input id={`${ids}-label`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} className="mt-1.5 block h-11 w-full max-w-sm rounded-xl border border-rule-strong bg-paper px-3 text-[0.95rem]" />
            <p className="mt-1 text-[0.8rem] text-ink-3">Other organizers see this on every approval you sign.</p>
          </div>
          {roster.inviteRequired ? (
            <div>
              <label htmlFor={`${ids}-invite`} className="text-[0.9rem] font-semibold text-ink">
                Invite code
              </label>
              <input id={`${ids}-invite`} value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="one-time-code" className="mt-1.5 block h-11 w-full max-w-[16rem] rounded-xl border border-rule-strong bg-paper px-3 tracking-wide" required />
              <p className="mt-1 text-[0.8rem] text-ink-3">An existing organizer gets it for you, so nobody can enroll in your name.</p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !who} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-raised active:scale-[0.98] disabled:opacity-70">
              {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Fingerprint size={18} aria-hidden />}
              Create passkey for {name}
            </button>
            <button type="button" onClick={() => setMode('signin')} className="min-h-11 px-2 text-[0.92rem] text-ink-2 underline underline-offset-4 hover:text-ink">
              I already have one
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[0.9rem] text-signal">
          {error}
        </p>
      )}

      {roster.demoMode && (
        <div className="mt-5 border-t border-rule pt-4">
          <label className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9rem] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <KeyRound size={16} aria-hidden /> No passkey handy? In this demo, approve with
            </span>
            <select
              value={demoAs ?? ''}
              onChange={(e) => onDemoAs(e.target.value || null)}
              className="h-11 rounded-full border border-rule-strong bg-paper px-4 text-[0.92rem] font-medium text-ink"
            >
              <option value="">nobody yet</option>
              {organizers
                .filter((o) => o.id === 'org_marcus')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}’s demo key
                  </option>
                ))}
            </select>
          </label>
          <p className="mt-1.5 text-[0.8rem] text-ink-3">
            In this demo you play Marcus. His demo key is held by this server and signs only requests you sent yourself (from /call or a /demo run); Dana is played by the demo script. Every card it signs says “demo key”.
          </p>
        </div>
      )}
    </section>
  );
}
