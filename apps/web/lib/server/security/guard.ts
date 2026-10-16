/**
 * Cross-site request protection for state-changing API routes (QA P1-3, P2-9).
 *
 * A cross-site <form> or `fetch(..., {mode: 'no-cors'})` can only send "simple" requests:
 * text/plain, multipart/form-data or application/x-www-form-urlencoded, without custom headers.
 * So: JSON routes accept only `application/json` (415 otherwise, which forces a CORS preflight we
 * never answer), and every non-GET /api request from a browser must come from our own origin
 * (Sec-Fetch-Site: same-origin|none, or an Origin header equal to ours). Server-to-server callers
 * (PayPal webhooks, Render Workflows on /api/internal/*) are exempt here and authenticated by their
 * own signatures. Requests with neither header are not from a browser and cannot ride a victim's
 * cookies, so they pass this check (they still need everything else: signatures, sessions, limits).
 */
import { HttpError } from '../errors';

export const CSRF_EXEMPT = [/^\/api\/webhooks\/paypal$/, /^\/api\/internal\//];

const originOfUrl = (u: string | undefined | null): string | null => {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/** Origins this deployment answers on (request Host, APP_BASE_URL, RENDER_EXTERNAL_URL, WEBAUTHN_ORIGIN). */
export function allowedOrigins(req: Request, env: Record<string, string | undefined> = process.env): Set<string> {
  const out = new Set<string>();
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  if (host) out.add(`${proto}://${host}`);
  out.add(new URL(req.url).origin);
  for (const u of [env.APP_BASE_URL, env.RENDER_EXTERNAL_URL, ...(env.WEBAUTHN_ORIGIN ?? '').split(',')]) {
    const o = originOfUrl(u?.trim());
    if (o) out.add(o);
  }
  return out;
}

/** null when allowed, else the reason. */
export function crossSiteProblem(req: Request, env: Record<string, string | undefined> = process.env): string | null {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const path = new URL(req.url).pathname;
  if (CSRF_EXEMPT.some((re) => re.test(path))) return null;
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return `cross-site request (Sec-Fetch-Site: ${site})`;
  const origin = req.headers.get('origin');
  if (origin && (origin === 'null' || !allowedOrigins(req, env).has(origin))) return `cross-origin request from ${origin}`;
  return null;
}

export function assertSameOrigin(req: Request): void {
  const problem = crossSiteProblem(req);
  if (problem) throw new HttpError(403, `Refused: ${problem}.`);
}

/** JSON bodies only (415 otherwise). Charset parameters are fine. */
export function assertJson(req: Request): void {
  const ct = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (ct !== 'application/json') throw new HttpError(415, 'Send this as application/json.');
}

export const MAX_JSON_BYTES = 64 * 1024;

/** Read a request body as text, refusing (413) beyond `max` bytes even without a Content-Length. */
export async function readCapped(req: Request, max = MAX_JSON_BYTES): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, `Request body too large (limit ${Math.round(max / 1024)} KB).`);
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, `Request body too large (limit ${Math.round(max / 1024)} KB).`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
