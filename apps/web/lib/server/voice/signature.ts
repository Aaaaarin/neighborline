/**
 * X-Twilio-Signature validation (twilio.com/docs/usage/webhooks/webhooks-security):
 *
 *   signature = base64( HMAC-SHA1( authToken, url + Σ sorted(name) name + value ) )
 *
 * `url` is the full URL Twilio requested, query string included, exactly as Twilio saw it. Form
 * parameters are sorted by name and appended as name+value with no separators (a repeated name
 * contributes each distinct value, sorted). This mirrors twilio-node's validateRequest (5.x), including
 * its leniency about the default port (Twilio may sign "https://host/x" or "https://host:443/x") and the
 * legacy query-string encoding; tests pin the result to vectors produced by that SDK.
 *
 * We do not depend on the twilio SDK: this is ~60 lines, and the comparison is constant-time.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parse as parseQs, stringify as stringifyQs } from 'node:querystring';

export type TwilioParams = Record<string, string | string[]>;

export function expectedSignature(authToken: string, url: string, params: TwilioParams): string {
  let data = url;
  for (const name of Object.keys(params).sort()) {
    const v = params[name]!;
    if (Array.isArray(v)) for (const each of [...new Set(v)].sort()) data += name + each;
    else data += name + v;
  }
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function withoutPort(u: URL): string {
  const c = new URL(u.toString());
  c.port = '';
  return c.toString();
}

function withPort(u: URL): string {
  if (u.port) return u.toString();
  const port = u.protocol === 'https:' ? '443' : '80';
  const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : '';
  return `${u.protocol}//${auth}${u.host}:${port}${u.pathname}${u.search}${u.hash}`;
}

function legacyQuery(url: string): string {
  const u = new URL(url);
  if (!u.search) return url;
  const qs = parseQs(u.search.slice(1));
  u.search = '';
  return `${u.toString()}?${stringifyQs(qs)}`;
}

/** The URL variants twilio-node accepts for one URL (with/without default port, legacy query encoding). */
export function urlVariants(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const a = withoutPort(u);
  const b = withPort(u);
  return [...new Set([a, b, legacyQuery(a), legacyQuery(b)])];
}

/** True when `signature` matches any variant of any candidate URL. */
export function validateSignature(authToken: string, signature: string | null | undefined, candidateUrls: string[], params: TwilioParams): boolean {
  if (!authToken || !signature) return false;
  for (const url of candidateUrls) {
    for (const v of urlVariants(url)) {
      if (safeEqual(signature, expectedSignature(authToken, v, params))) return true;
    }
  }
  return false;
}

/**
 * The URLs Twilio may have called for this request. Behind a proxy (Render) `req.url` is the internal
 * address, so the configured public base comes first, then the forwarded host/proto, then req.url.
 * Choosing a URL is not a security decision: without the auth token no URL yields a valid signature.
 */
export function candidateUrls(req: Request, publicBase: string | null): string[] {
  const u = new URL(req.url);
  const pathAndQuery = `${u.pathname}${u.search}`;
  const out: string[] = [];
  if (publicBase) out.push(`${publicBase.replace(/\/$/, '')}${pathAndQuery}`);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto = (req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')).split(',')[0]!.trim();
    out.push(`${proto}://${host.split(',')[0]!.trim()}${pathAndQuery}`);
  }
  out.push(u.toString());
  return [...new Set(out)];
}

/** application/x-www-form-urlencoded body → params (repeated names become arrays). */
export function parseForm(body: string): TwilioParams {
  const out: TwilioParams = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const prev = out[k];
    if (prev === undefined) out[k] = v;
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/** First value of a param ('' when absent). */
export const param = (p: TwilioParams, name: string): string => {
  const v = p[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
