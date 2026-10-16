/**
 * HMAC verification for POST /api/internal/* — a copy of workflows/src/signing.ts (the workflows
 * package is deployed separately and is not a workspace dependency). A drift test
 * (lib/server/internal.test.ts) fails if the two diverge.
 *
 * Original header: HMAC request signing between Render Workflows and the web app's /api/internal/* routes.
 *
 * Headers:
 *   x-neighborline-timestamp: <unix seconds>
 *   x-neighborline-signature: v1=<hex HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${rawBody}`)>
 *
 * `path` is the URL pathname only (no host, no query), e.g. `/api/internal/reconcile`.
 * The web app must verify with `verifyInternalRequest` (copy this file, it only needs node:crypto)
 * against the RAW body (`await req.text()`), reject if |now - ts| > 300 s, and compare in constant time.
 *
 * Why not a bearer token: a captured request cannot be replayed after 5 minutes or re-targeted at
 * another internal route. Why a separate secret: NEIGHBORLINE_APPROVAL_SECRET can move money (MCP);
 * the scheduler must never hold it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TIMESTAMP_HEADER = 'x-neighborline-timestamp';
export const SIGNATURE_HEADER = 'x-neighborline-signature';
export const MAX_SKEW_SECONDS = 300;

export function signatureBase(ts: string, method: string, path: string, rawBody: string): string {
  return `${ts}.${method.toUpperCase()}.${path}.${rawBody}`;
}

export function sign(secret: string, ts: string, method: string, path: string, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(signatureBase(ts, method, path, rawBody)).digest('hex');
}

export function signedHeaders(
  secret: string,
  method: string,
  path: string,
  rawBody: string,
  nowMs: number = Date.now(),
): Record<string, string> {
  const ts = String(Math.floor(nowMs / 1000));
  return { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sign(secret, ts, method, path, rawBody) };
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'bad_signature' | 'no_secret' };

/** For the web app. `headers` can be a Fetch `Headers` or a plain lowercase-keyed object. */
export function verifyInternalRequest(args: {
  secret: string | undefined;
  method: string;
  path: string;
  rawBody: string;
  headers: { get(name: string): string | null } | Record<string, string | undefined>;
  nowMs?: number;
}): VerifyResult {
  const { secret, method, path, rawBody, headers } = args;
  if (!secret || secret.length < 32) return { ok: false, reason: 'no_secret' };
  const get = (k: string): string | undefined =>
    typeof (headers as { get?: unknown }).get === 'function'
      ? ((headers as { get(name: string): string | null }).get(k) ?? undefined)
      : (headers as Record<string, string | undefined>)[k];
  const ts = get(TIMESTAMP_HEADER);
  const sig = get(SIGNATURE_HEADER);
  if (!ts || !sig) return { ok: false, reason: 'missing' };
  const tsNum = Number(ts);
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (!Number.isInteger(tsNum) || Math.abs(now - tsNum) > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(sign(secret, ts, method, path, rawBody));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}
