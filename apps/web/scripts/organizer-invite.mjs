#!/usr/bin/env node
// Print the passkey invite code for an organizer: HMAC(NEIGHBORLINE_SESSION_SECRET, "invite:<id>")[0..12].
// Same derivation as lib/server/passkeys/secret.ts. Usage: NEIGHBORLINE_SESSION_SECRET=… pnpm organizer-invite org_dana
import { createHmac } from 'node:crypto';

const id = process.argv[2];
const secret = process.env.NEIGHBORLINE_SESSION_SECRET;
if (!id || !secret || secret.length < 32) {
  console.error('usage: NEIGHBORLINE_SESSION_SECRET=<≥32 chars, same as the server> organizer-invite <organizerId>');
  process.exit(1);
}
console.log(createHmac('sha256', Buffer.from(secret, 'utf8')).update(`invite:${id}`).digest('base64url').slice(0, 12));
