/**
 * Sandbox stand-ins for the scripted /demo payouts (NOTES-golive.md).
 *
 * PayPal documents no way to make a sandbox Venmo payout settle, and the scripted neighbors' addresses
 * are fictional. With `PAYPAL_MODE=sandbox`, DEMO_MODE on and `SANDBOX_DEMO_RECEIVER_EMAIL` set (a sandbox
 * Personal account), a /demo run pays for real:
 *   - Lan, Jean, Walter: that sandbox account's PayPal wallet, by EMAIL, so the item reaches SUCCESS;
 *   - Rosa: a fresh unregistered address per run, so the item genuinely stays UNCLAIMED (nobody claims it
 *     for her; an organizer can cancel it and the money returns to the fund).
 * The scripted destination is still what the neighbor said and what the read-back repeats; rail checks
 * run on it first (intake.confirmIntake), and the swap is recorded in the audit log and said on every
 * screen (stage, both phones, the organizer card). Fake mode is unchanged.
 *
 * Venmo, for every request (observed 2026-10-28): the real sandbox refuses a whole payout batch that contains any
 * Venmo item ("Recipient wallet not supported in sandbox"). So with stand-ins on, ANY request whose destination is
 * Venmo (scripted runs, visitor /call requests `req_v_*`, phone calls) is filed to the stand-in account after the
 * rail checks on the handle the neighbor gave, labelled "PayPal's sandbox can't pay Venmo…". With stand-ins off in
 * sandbox, the approver refuses Venmo items up front (code `wallet_unsupported`) and the card says why before anyone
 * signs (`SANDBOX_VENMO_NOTICE`). Live mode is untouched.
 */
import { randomBytes } from 'node:crypto';
import { demoModeOn } from '@neighborline/passkeys';
import { hasBlockingFlag, type HelpRequest, type PayoutDestination } from '@neighborline/core';
import { appendAudit, updateRequest } from '@neighborline/db';
import type { ScenarioId } from '../../types';
import { errorText, log } from '../log';
import { isDemoId, type BaseCtx } from './context';
import type { Env } from './env';
import type { Rail } from './intake';
import { maskReceiver } from './ledger';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rosa's per-run address: unregistered, and recognisable (the fake treats "unclaimed" as unregistered too). */
export const UNCLAIMED_STANDIN = /^neighborline-unclaimed-rosa-[0-9a-f]{8,}@example\.com$/;

/**
 * The sandbox receiver for /demo payouts, or null when stand-ins are off: only with PAYPAL_MODE=sandbox,
 * DEMO_MODE on (the approver must exclude demo runs from history, or one shared account would hit caps)
 * and a plausible email in SANDBOX_DEMO_RECEIVER_EMAIL.
 */
export function sandboxDemoReceiver(env: Env, paypalMode: string): string | null {
  const v = (env.SANDBOX_DEMO_RECEIVER_EMAIL ?? '').trim();
  if (paypalMode !== 'sandbox' || !v || !EMAIL.test(v) || !demoModeOn(env)) return null;
  return v;
}

export interface StandIn {
  kind: 'receiver' | 'unclaimed';
  /** Where the payout really goes. */
  destination: PayoutDestination;
  /** What the neighbor said (rail checks run on it first). */
  scripted: { wallet: 'PAYPAL' | 'VENMO'; value: string };
  /** One English sentence, shown on the stage, both phones and the organizer card. */
  note: string;
}

const walletWord = (w: 'PAYPAL' | 'VENMO', type: string) => (w === 'VENMO' ? 'Venmo' : type === 'EMAIL' ? 'PayPal email' : 'PayPal');

/** The label for a Venmo destination paid to the stand-in. `whose` is e.g. "Lan’s Venmo @lan-nguyen54" or "@handle". */
export const venmoStandInNote = (whose: string): string => `Sandbox: PayPal’s sandbox can’t pay Venmo, so this goes to a PayPal sandbox account standing in for ${whose}.`;

/** Shown on the organizer card for a Venmo destination in sandbox when no stand-in is configured. */
export const SANDBOX_VENMO_NOTICE =
  'Sandbox: PayPal’s sandbox can’t pay Venmo (it refuses the whole batch), so the approval service won’t send this. Ask the neighbor for a PayPal email instead.';

const handleOf = (value: string) => (value.startsWith('@') ? value : `@${value}`);

/**
 * Any request (not only scripted runs) with a Venmo destination, when stand-ins are on: the stand-in account, labelled.
 * Null for PayPal destinations (a visitor's own sandbox email is paid as given).
 */
export function venmoStandIn(dest: PayoutDestination, receiver: string | null): StandIn | null {
  if (!receiver || dest.wallet !== 'VENMO') return null;
  return {
    kind: 'receiver',
    destination: { wallet: 'PAYPAL', type: 'EMAIL', value: receiver, ...(dest.nameOnFile ? { nameOnFile: dest.nameOnFile } : {}) },
    scripted: { wallet: 'VENMO', value: dest.value },
    note: venmoStandInNote(handleOf(dest.value)),
  };
}

export function standInFor(input: { scenario: ScenarioId; name: string; scripted: PayoutDestination; receiver: string; nonce?: string }): StandIn | null {
  const { scenario, name, scripted } = input;
  if (scenario === 'blocked') return null;
  const whose = `${name}’s ${walletWord(scripted.wallet, scripted.type)}`;
  const base = { scripted: { wallet: scripted.wallet, value: scripted.value } };
  const keepName = scripted.nameOnFile ? { nameOnFile: scripted.nameOnFile } : {};
  if (scenario === 'rosa') {
    const value = `neighborline-unclaimed-rosa-${input.nonce ?? randomBytes(6).toString('hex')}@example.com`;
    return {
      ...base,
      kind: 'unclaimed',
      destination: { wallet: 'PAYPAL', type: 'EMAIL', value, ...keepName },
      note: `Sandbox: sent to a fresh unregistered address standing in for ${whose}, so it really goes UNCLAIMED. Nobody can claim it for her here; an organizer can cancel it.`,
    };
  }
  return {
    ...base,
    kind: 'receiver',
    destination: { wallet: 'PAYPAL', type: 'EMAIL', value: input.receiver, ...keepName },
    note: scripted.wallet === 'VENMO' ? venmoStandInNote(`${whose} ${handleOf(scripted.value)}`) : `Sandbox: paid to a PayPal sandbox account standing in for ${whose}.`,
  };
}

/** Is this the shared stand-in account? (PayPal wallet, same email; the approver's recheck uses the same rule.) */
export const isStandInDestination = (dest: { wallet: string; value: string }, receiver: string | null): boolean =>
  !!receiver && dest.wallet === 'PAYPAL' && dest.value.trim().toLowerCase() === receiver.trim().toLowerCase();

/** After a restart the in-memory note is gone: recognise a stand-in from the stored destination. */
export function standInNoteFromDestination(requestId: string, dest: PayoutDestination | null | undefined, receiver: string | null): string | null {
  if (!dest) return null;
  const demo = requestId.startsWith('req_demo_');
  if (isStandInDestination(dest, receiver)) return demo ? 'Sandbox: paid to a PayPal sandbox account standing in for the neighbor’s scripted Venmo or PayPal.' : venmoStandInNote('the neighbor’s Venmo');
  if (demo && UNCLAIMED_STANDIN.test(dest.value)) return 'Sandbox: sent to a fresh unregistered address standing in for the neighbor’s scripted email, so it really goes UNCLAIMED.';
  return null;
}

/**
 * confirmIntake, after the rail checks on the scripted destination: a demo run with a stand-in files the
 * stand-in as the payout destination (what the organizers sign and the approver pays), unless the scripted
 * destination was blocked or the stand-in itself would be. Returns the updated request and the rail result
 * (the scripted checks' flags kept, the stand-in's added), or null when nothing changed.
 */
export async function swapToStandIn(ctx: BaseCtx, req: HelpRequest, scripted: Rail, railOn: (dest: PayoutDestination) => Promise<Rail>): Promise<{ req: HelpRequest; rail: Rail } | null> {
  if (!req.payoutDestination || hasBlockingFlag(scripted.flags)) return null;
  // A scripted run's own stand-in, else (any request) the Venmo stand-in: the sandbox refuses Venmo outright.
  const standIn = (isDemoId(req.id) ? ctx.meta.get(req.id)?.standIn : undefined) ?? venmoStandIn(req.payoutDestination, sandboxDemoReceiver(ctx.env, ctx.cfg.paypalMode));
  if (!standIn) return null;
  if (req.payoutDestination.value === standIn.destination.value) return null;
  const rail = await railOn(standIn.destination);
  if (hasBlockingFlag(rail.flags)) {
    log.warn('sandbox.standin_blocked', { requestId: req.id, flags: rail.flags.map((f) => f.code).join(',') });
    return null;
  }
  try {
    const updated = await updateRequest(ctx.db, req.id, { payoutDestination: standIn.destination }, { actor: 'sandbox-stand-in' });
    ctx.meta.ensure(req.id).standIn = standIn;
    await appendAudit(ctx.db, {
      actor: 'sandbox-stand-in',
      action: 'demo.sandbox_stand_in',
      entityType: 'request',
      entityId: req.id,
      data: { kind: standIn.kind, scripted: { wallet: standIn.scripted.wallet, value: maskReceiver(standIn.scripted.value) }, paidTo: { wallet: 'PAYPAL', value: maskReceiver(standIn.destination.value) } },
    });
    return { req: updated, rail: { ...rail, flags: [...scripted.flags, ...rail.flags.filter((f) => !scripted.flags.some((g) => g.code === f.code))] } };
  } catch (err) {
    log.warn('sandbox.standin_failed', { requestId: req.id, error: errorText(err) });
    return null;
  }
}
