'use client';

import { Fingerprint, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { passkeyErrorMessage } from '@/lib/passkey-client';
import type { OrganizerSession, PasskeyRoster } from '@/lib/types';

/**
 * Organizer settings: every passkey that can sign for the group, and a way to revoke one (lost phone,
 * someone leaves). Any signed-in organizer can revoke; the audit log records who did.
 */
export function Devices({ roster: initial, session, onSignedOut }: { roster: PasskeyRoster; session: OrganizerSession | null; onSignedOut: () => void }) {
  const [roster, setRoster] = useState(initial);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Enrolling or signing in on this page adds a device: show it.
  useEffect(() => {
    if (!session) return;
    void api
      .organizerMe()
      .then((r) => setRoster(r.roster))
      .catch(() => {});
  }, [session]);
  const total = roster.organizers.reduce((n, o) => n + o.passkeys.length, 0);

  const revoke = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const r = await api.revokePasskey(id);
      const { roster: fresh } = await api.organizerMe();
      setRoster(fresh);
      setConfirm(null);
      setNote(`Revoked ${r.deviceLabel}. It can no longer sign in, approve or sign rules.`);
      if (r.signedOut) onSignedOut();
    } catch (err) {
      setNote(passkeyErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="group mt-14 border-t border-rule pt-5" open={!!note || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-display text-[1.3rem] text-ink">Devices that can sign</span>
          <span className="block text-[0.85rem] text-ink-3">{total === 0 ? 'No passkeys yet' : total === 1 ? '1 passkey' : `${total} passkeys`} across {roster.organizers.length} organizers</span>
        </span>
        <span className="text-[0.88rem] text-ink-2 underline underline-offset-4 group-open:hidden">Manage</span>
      </summary>
      <p className="mt-3 max-w-[56ch] text-[0.9rem] text-ink-2">
        Lost a phone? Revoke its passkey here. From then on it can’t sign in, approve a payout or sign new rules, and signatures it made on anything not yet paid or activated stop counting.
      </p>
      {!session && <p className="mt-2 text-[0.88rem] text-ink-3">Sign in with a passkey to revoke a device. Demo keys belong to this demo server and can’t be revoked.</p>}
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {roster.organizers.map((o) => (
          <li key={o.id} className="py-3">
            <p className="font-semibold text-ink">{o.name}</p>
            {o.passkeys.length === 0 ? (
              <p className="text-[0.85rem] text-ink-3">No passkey set up</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {o.passkeys.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="flex items-center gap-2 text-[0.92rem] text-ink-2">
                      <Fingerprint size={15} aria-hidden />
                      {p.deviceLabel}
                      <span className="text-[0.8rem] text-ink-3">
                        added {shortDate(p.createdAt)}
                        {p.lastUsedAt ? `, last used ${shortDate(p.lastUsedAt)}` : ''}
                        {session?.credentialId === p.id ? ', this device' : ''}
                      </span>
                    </p>
                    {session &&
                      (confirm === p.id ? (
                        <span className="flex items-center gap-2">
                          <button type="button" onClick={() => setConfirm(null)} className="min-h-10 rounded-full px-3 text-[0.88rem] text-ink-2 hover:bg-sunk">
                            Keep it
                          </button>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => void revoke(p.id)}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-signal px-3.5 text-[0.88rem] font-semibold text-raised disabled:opacity-60"
                          >
                            {busy === p.id && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
                            Revoke {p.deviceLabel}{session.credentialId === p.id ? ' and sign out' : ''}
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirm(p.id)} className="min-h-10 rounded-full border border-rule-strong px-3.5 text-[0.88rem] font-medium text-ink hover:border-ink">
                          Revoke
                        </button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {note && (
        <p role="status" className="mt-3 text-[0.9rem] text-ink-2">
          {note}
        </p>
      )}
    </details>
  );
}
