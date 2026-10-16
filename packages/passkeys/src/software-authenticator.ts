/**
 * A software authenticator for DEMO_MODE: a P-256 key held by the server that produces real
 * WebAuthn-format assertions (authenticatorData + clientDataJSON + ECDSA signature), so the demo
 * stage runs through the same verification code as a phone's passkey. It is never presented as
 * a passkey: every assertion it makes is stored with kind 'demo_key', and it sets only the
 * User Present flag (not User Verified), because no human unlocked anything.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { fromB64url, toB64url } from './encoding.js';
import type { AssertionParts } from './assertion.js';

export interface SoftwareAuthenticator {
  credentialId: string;
  /** base64url COSE_Key (EC2, P-256, ES256), the format organizer_credentials.public_key stores */
  publicKey: string;
  sign(input: { challenge: string; origin: string; rpId: string }): AssertionParts;
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

/** COSE_Key for an ES256 public key: {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}. */
export function coseFromEcPublicKey(key: KeyObject): Uint8Array {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('expected a P-256 public key');
  const m = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, fromB64url(jwk.x)],
    [-3, fromB64url(jwk.y)],
  ]);
  return isoCBOR.encode(m as unknown as Parameters<typeof isoCBOR.encode>[0]);
}

/**
 * `userVerified` exists for tests that stand in for a phone's passkey; the demo signer never sets it.
 */
export function createSoftwareAuthenticator(opts: { privateKeyPem?: string; credentialId?: string; userVerified?: boolean } = {}): SoftwareAuthenticator {
  const privateKey = opts.privateKeyPem ? createPrivateKey(opts.privateKeyPem) : generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const publicKey = createPublicKey(privateKey);
  const cose = coseFromEcPublicKey(publicKey);
  const credentialId = opts.credentialId ?? toB64url(randomBytes(16));
  return {
    credentialId,
    publicKey: toB64url(cose),
    sign({ challenge, origin, rpId }) {
      // authenticatorData = rpIdHash(32) | flags(1) | signCount(4). Flags: UP (0x01), + UV (0x04) only when asked.
      const authData = Buffer.concat([sha256(rpId), Buffer.from([opts.userVerified ? 0x05 : 0x01]), Buffer.alloc(4)]);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }), 'utf8');
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), { key: privateKey, dsaEncoding: 'der' });
      return {
        credentialId,
        authenticatorData: toB64url(authData),
        clientDataJSON: toB64url(clientData),
        signature: toB64url(signature),
      };
    },
  };
}
