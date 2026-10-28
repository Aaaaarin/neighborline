/**
 * Secret hygiene for spike JSON that crosses the browser → container boundary. The browser scrubs before returning;
 * the ingest refuses anything that still looks like a credential. Both use the same rules, so a scrubbed result always
 * ingests. Pure: no I/O, safe in the browser bundle.
 */

/** Object keys that never belong in evidence (dropped by scrub, refused by ingest). */
export const SECRET_KEY = /^(authorization|proxy-authorization|access_?token|refresh_?token|id_?token|client_?secret|clientsecret|secret|sec|password|passwd|api_?key|apikey|bearer|cookie|set-cookie|x-api-key)$/i;

/** String shapes that are credentials wherever they appear. */
export const SECRET_VALUES: ReadonlyArray<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer token'],
  [/\bBasic\s+[A-Za-z0-9+/=]{16,}/gi, 'Basic credentials'],
  [/\bA21AA[A-Za-z0-9_-]{20,}/g, 'PayPal access token'],
  // PayPal REST client ids (A…) and secrets (E…) are 80 characters; nothing in the spike's data is that long.
  [/(?<![A-Za-z0-9_-])[AE][A-Za-z0-9_-]{70,}(?![A-Za-z0-9_-])/g, 'PayPal client id/secret'],
];

export const REDACTED = '[redacted]';

/** Paths (`orders.capture.foo`) of everything that looks like a secret, with the reason. Empty = clean. */
export function findSecrets(value: unknown, known: readonly string[] = []): string[] {
  const out: string[] = [];
  const knownValues = known.filter((k) => k && k.length >= 8);
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 40) return void out.push(`${path || '(root)'}: nested too deep`);
    if (typeof v === 'string') {
      for (const [rx, why] of SECRET_VALUES) if (new RegExp(rx.source, rx.flags.replace('g', '')).test(v)) out.push(`${path || '(root)'}: ${why}`);
      if (knownValues.some((k) => v.includes(k))) out.push(`${path || '(root)'}: a credential value`);
      return;
    }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (SECRET_KEY.test(k)) out.push(`${p}: secret-looking key "${k}"`);
      else visit(x, p, depth + 1);
    }
  };
  visit(value, '', 0);
  return out;
}

/** A deep copy with secret keys removed and secret-looking strings (and every `known` value) replaced by [redacted]. */
export function scrubSecrets<T>(value: T, known: readonly string[] = []): T {
  const knownValues = known.filter((k) => k && k.length >= 8).sort((a, b) => b.length - a.length);
  const str = (s: string) => {
    let r = s;
    for (const k of knownValues) r = r.split(k).join(REDACTED);
    for (const [rx] of SECRET_VALUES) r = r.replace(rx, REDACTED);
    return r;
  };
  const visit = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return str(v);
    if (!v || typeof v !== 'object' || depth > 40) return v;
    if (Array.isArray(v)) return v.map((x) => visit(x, depth + 1));
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SECRET_KEY.test(k) && x !== undefined) o[k] = visit(x, depth + 1);
    return o;
  };
  return visit(value, 0) as T;
}
