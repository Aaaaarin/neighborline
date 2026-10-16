/** Byte helpers shared by the browser-facing JSON (base64url) and the approval hash (hex). */
import { isoBase64URL } from '@simplewebauthn/server/helpers';

const HEX64 = /^[0-9a-f]{64}$/;

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new TypeError('hexToBytes: not a hex string');
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const toB64url = (bytes: Uint8Array): string => isoBase64URL.fromBuffer(bytes as Parameters<typeof isoBase64URL.fromBuffer>[0]);
export const fromB64url = (s: string): Uint8Array => isoBase64URL.toBuffer(s);

/**
 * The WebAuthn challenge an organizer signs to approve: the 32 raw bytes of the approval hash
 * (core `approvalHash`, SHA-256 over the canonical approval payload), base64url-encoded.
 * A signature over this challenge is a signature over exactly what will be paid.
 */
export function challengeForApprovalHash(approvalHash: string): string {
  if (!HEX64.test(approvalHash)) throw new TypeError('approval hash must be 64 lowercase hex chars');
  return toB64url(hexToBytes(approvalHash));
}

/** Inverse of {@link challengeForApprovalHash}; null when the challenge is not a 32-byte value. */
export function approvalHashFromChallenge(challenge: string): string | null {
  try {
    const bytes = fromB64url(challenge);
    return bytes.length === 32 ? bytesToHex(bytes) : null;
  } catch {
    return null;
  }
}
