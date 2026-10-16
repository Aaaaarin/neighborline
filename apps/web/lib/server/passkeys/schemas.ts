/** zod for the WebAuthn JSON browsers send (shape of @simplewebauthn/browser responses). */
import { z } from 'zod';

const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/).max(4096);

export const AssertionJSON = z.object({
  id: b64,
  rawId: b64,
  type: z.literal('public-key'),
  response: z.object({ authenticatorData: b64, clientDataJSON: b64, signature: b64, userHandle: b64.optional() }),
  clientExtensionResults: z.record(z.unknown()).optional(),
  authenticatorAttachment: z.string().optional(),
});

export const RegistrationJSON = z.object({
  id: b64,
  rawId: b64,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: b64,
    attestationObject: b64,
    authenticatorData: b64.optional(),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: b64.optional(),
  }),
  clientExtensionResults: z.record(z.unknown()).default({}),
  authenticatorAttachment: z.string().optional(),
});

export const originOf = (req: Request): string | null => req.headers.get('origin');
export const isSecure = (req: Request): boolean => (req.headers.get('origin') ?? req.url).startsWith('https:');
