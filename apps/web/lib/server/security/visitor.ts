/**
 * Per-visitor demo sessions (judge isolation, QA P1-3 / P1-4).
 *
 * Every browser gets an HMAC-signed, HttpOnly cookie `nl_visitor` holding a random id the first time
 * it creates something (a /demo run, a /call request). Its public *tag* (12 hex of a domain-separated
 * SHA-256 of the id) is baked into the ids of what that visitor creates:
 *
 *   /demo runs        req_demo_<tag>_<hex>   (demo rehearsals, excluded from household caps)
 *   /call requests    req_v_<tag>_<hex>      (real intake path, caps apply)
 *
 * Ownership is therefore stateless and survives restarts and demo resets: a request is "yours" when
 * its id carries the tag of the cookie you hold. The cookie cannot be forged without
 * NEIGHBORLINE_SESSION_SECRET, and a tag cannot be turned back into an id. The approver re-checks the
 * same tag binding for demo-visitor passkeys (apps/approver/src/assertions.ts).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hmac, sessionSecret } from '../passkeys/secret';

export const VISITOR_COOKIE = 'nl_visitor';
const MAX_AGE_S = 30 * 24 * 3600;
const TAG_RE = /^[0-9a-f]{12}$/;

export interface Visitor {
  id: string;
  tag: string;
  /** Minted by this request: the response must set the cookie. */
  fresh: boolean;
}

export const visitorTag = (id: string): string => createHash('sha256').update(`neighborline/visitor-tag/v1\n${id}`).digest('hex').slice(0, 12);

const mac = (id: string, env?: Record<string, string | undefined>) => hmac(sessionSecret(env), `visitor:${id}`);

export function encodeVisitor(id: string, env?: Record<string, string | undefined>): string {
  return `${id}.${mac(id, env)}`;
}

export function decodeVisitor(raw: string | undefined | null, env?: Record<string, string | undefined>): Visitor | null {
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  const want = Buffer.from(mac(id, env));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { id, tag: visitorTag(id), fresh: false };
}

function cookieValue(req: Request): string | undefined {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.split(/;\s*/).find((c) => c.startsWith(`${VISITOR_COOKIE}=`));
  return m?.slice(VISITOR_COOKIE.length + 1);
}

export function visitorFromRequest(req: Request): Visitor | null {
  return decodeVisitor(cookieValue(req));
}

/** The caller's visitor, minting one (fresh=true) when the browser has none or a bad one. */
export function ensureVisitor(req: Request): Visitor {
  const v = visitorFromRequest(req);
  if (v) return v;
  const id = randomBytes(18).toString('base64url');
  return { id, tag: visitorTag(id), fresh: true };
}

export function visitorCookieHeader(v: Visitor, secure: boolean): string {
  return `${VISITOR_COOKIE}=${encodeVisitor(v.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`;
}

/** JSON response that also sets the visitor cookie when it was minted for this request. */
export function jsonWithVisitor(body: unknown, v: Visitor, req: Request, init: ResponseInit = {}): Response {
  const res = Response.json(body, init);
  if (v.fresh) res.headers.append('set-cookie', visitorCookieHeader(v, (req.headers.get('origin') ?? req.url).startsWith('https:')));
  return res;
}

/* ---------------- ids that carry the owner's tag ---------------- */

const hex = (n: number) => randomBytes(n).toString('hex');

export const demoRunId = (tag: string): string => {
  if (!TAG_RE.test(tag)) throw new Error('bad visitor tag');
  return `req_demo_${tag}_${hex(6)}`;
};

export const visitorRequestId = (tag: string): string => {
  if (!TAG_RE.test(tag)) throw new Error('bad visitor tag');
  return `req_v_${tag}_${hex(8)}`;
};

/** The visitor tag a request id carries (demo run or web intake), or null for seeded / channel requests. */
export function ownerTagOf(requestId: string): string | null {
  const m = /^req_(?:demo|v)_([0-9a-f]{12})_[0-9a-f]+$/.exec(requestId);
  return m ? m[1]! : null;
}

/** Demo runs only (what a demo-visitor passkey may sign). */
export function demoRunTagOf(requestId: string): string | null {
  const m = /^req_demo_([0-9a-f]{12})_[0-9a-f]+$/.exec(requestId);
  return m ? m[1]! : null;
}

export const DEMO_VISITOR_BINDING = (tag: string): string => `demo-visitor:${tag}`;
export const bindingTag = (boundTo: string | null | undefined): string | null => /^demo-visitor:([0-9a-f]{12})$/.exec(boundTo ?? '')?.[1] ?? null;
