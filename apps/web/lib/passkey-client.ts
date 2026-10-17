'use client';
/**
 * Browser side of organizer passkeys (@simplewebauthn/browser 14). Every Approve tap asks the
 * phone to sign the approval hash; nothing here decides who may approve — the server verifies.
 */
import {
  WebAuthnError,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { api, ApiError } from './api';
import type { ApprovalResult, OrganizerSession, PasskeyAssertionJSON, PolicySignResult } from './types';

type RequestOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];
type CreationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

export async function passkeysAvailable(): Promise<boolean> {
  try {
    return browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable());
  } catch {
    return false;
  }
}

/**
 * "Dana’s iPhone · Safari", "Dana’s Mac · Chrome"… from the user agent; the organizer can edit it. The
 * server numbers a repeat ("… 2"), so two passkeys never read the same in "Devices that can sign".
 */
export function guessDeviceLabel(name: string, ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android phone'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : 'device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return browser ? `${name}’s ${device} · ${browser}` : `${name}’s ${device}`;
}

/** A judge's own device enrolled as a demo organizer: "Visitor’s Mac (as Marcus)". */
const visitorLabel = (name: string): string => `Visitor’s ${guessDeviceLabel(name).replace(/^.*?’s /, '')} (as ${name})`;

/** Human-readable reason for a failed ceremony, never vague. */
export function passkeyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_CEREMONY_ABORTED') return 'The passkey prompt was closed.';
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'This device already has a passkey for this organizer. Sign in instead.';
  }
  if (err instanceof Error && err.name === 'NotAllowedError') return 'The passkey prompt was closed or timed out.';
  return err instanceof Error ? err.message : 'The passkey didn’t work on this device.';
}

export async function enrollPasskey(input: { organizerId: string; deviceLabel: string; inviteCode?: string }): Promise<OrganizerSession> {
  const { optionsJSON } = await api.passkeyOptions(input.organizerId, input.inviteCode);
  const response = await startRegistration({ optionsJSON: optionsJSON as CreationOptions });
  const { session } = await api.passkeyRegister({ ...input, response });
  return session;
}

async function postJson<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json), cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * /demo only: enroll THIS device as a demo-visitor passkey playing Marcus. No invite code, no
 * organizer session: the server binds the credential to this browser's demo visitor id, so it signs
 * only this visitor's own demo runs (never the shared queue, never a policy, never a sign-in).
 */
export async function enrollDemoVisitorPasskey(input: { organizerId: string; deviceLabel: string }): Promise<OrganizerSession> {
  const { optionsJSON } = await postJson<{ optionsJSON: unknown }>('/api/organizer/passkeys/options', { organizerId: input.organizerId, demoVisitor: true });
  const response = await startRegistration({ optionsJSON: optionsJSON as CreationOptions });
  const { session } = await postJson<{ session: OrganizerSession }>('/api/organizer/passkeys', { ...input, demoVisitor: true, response });
  return session;
}

export async function signInWithPasskey(): Promise<OrganizerSession> {
  const { optionsJSON } = await api.signInOptions();
  const response = await startAuthentication({ optionsJSON: optionsJSON as RequestOptions });
  const { session } = await api.signIn(response as unknown as PasskeyAssertionJSON);
  return session;
}

/** Ask the device to sign this approval's hash, then send the tap. */
export async function approveWithPasskey(input: { requestIds: string[]; organizerId?: string; credentialIds?: string[] }): Promise<ApprovalResult> {
  const ch = await api.approvalChallenge(input);
  const assertion = await startAuthentication({ optionsJSON: ch.optionsJSON as unknown as RequestOptions });
  return api.approve({
    requestIds: input.requestIds,
    ...(input.organizerId ? { organizerId: input.organizerId } : {}),
    signer: { kind: 'passkey', assertion: assertion as unknown as PasskeyAssertionJSON },
  });
}

/** Ask the device to sign a policy draft's hash, then send the signature. */
export async function signPolicyWithPasskey(input: { draftHash: string; organizerId?: string }): Promise<PolicySignResult> {
  const ch = await api.policyChallenge(input);
  const assertion = await startAuthentication({ optionsJSON: ch.optionsJSON as unknown as RequestOptions });
  return api.signPolicy({ draftHash: input.draftHash, ...(input.organizerId ? { organizerId: input.organizerId } : {}), signer: { kind: 'passkey', assertion: assertion as unknown as PasskeyAssertionJSON } });
}

const VISITOR_KEY = 'nl_demo_visitor_credential';
const readVisitorCred = (organizerId: string): string | null => {
  try {
    return localStorage.getItem(`${VISITOR_KEY}:${organizerId}`);
  } catch {
    return null;
  }
};
const writeVisitorCred = (organizerId: string, id: string | null) => {
  try {
    if (id) localStorage.setItem(`${VISITOR_KEY}:${organizerId}`, id);
    else localStorage.removeItem(`${VISITOR_KEY}:${organizerId}`);
  } catch {
    /* storage blocked: the visitor just enrolls again next time */
  }
};

export type VisitorOutcome =
  | { signedWith: 'passkey'; result: ApprovalResult }
  | { signedWith: 'none'; reason: string; canUseDemoKey: true };

/**
 * /demo, "I'll approve as Marcus": a judge's own device signs as Marcus. First time, the browser
 * creates a demo passkey for Marcus on this device (one prompt), then signs the approval (second
 * prompt). Without a platform authenticator, or if the prompt fails, the caller offers the demo key.
 */
export async function approveAsVisitor(input: { requestIds: string[]; organizerId: string; name: string }): Promise<VisitorOutcome> {
  if (!(await passkeysAvailable())) return { signedWith: 'none', reason: 'This browser has no built-in passkey (Face ID, Touch ID, Windows Hello or a phone lock).', canUseDemoKey: true };
  try {
    let cred = readVisitorCred(input.organizerId);
    if (!cred) {
      const s = await enrollDemoVisitorPasskey({ organizerId: input.organizerId, deviceLabel: visitorLabel(input.name) });
      cred = s.credentialId;
      writeVisitorCred(input.organizerId, cred);
    }
    try {
      return { signedWith: 'passkey', result: await approveWithPasskey({ requestIds: input.requestIds, organizerId: input.organizerId, credentialIds: [cred] }) };
    } catch (err) {
      // The demo was reset (fresh database) and forgot this device's passkey: enroll once more.
      if (err instanceof ApiError && (err.status === 401 || (err.status === 403 && /demo passkey/.test(err.message)))) {
        writeVisitorCred(input.organizerId, null);
        const s = await enrollDemoVisitorPasskey({ organizerId: input.organizerId, deviceLabel: visitorLabel(input.name) });
        writeVisitorCred(input.organizerId, s.credentialId);
        return { signedWith: 'passkey', result: await approveWithPasskey({ requestIds: input.requestIds, organizerId: input.organizerId, credentialIds: [s.credentialId] }) };
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) throw err; // a real refusal (blocked, changed): don't paper over it
    return { signedWith: 'none', reason: passkeyErrorMessage(err), canUseDemoKey: true };
  }
}
