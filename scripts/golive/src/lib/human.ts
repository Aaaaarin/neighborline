/**
 * The app's human check (NOTES-security.md, apps/web/lib/pow.ts): with AI_MODE=live, model-using intake calls answer
 * 403 human_check_required until the visitor holds an `nl_human` cookie, earned by a small proof of work. A script
 * passes it the way the browser does: POST /api/human/challenge → solve → POST /api/human/verify, with the same
 * cookie jar as its intake calls (the pass is bound to the nl_visitor cookie). A Turnstile challenge cannot be
 * scripted: then the app must run with HUMAN_CHECK=pow (or without Turnstile keys) for this step.
 */
import { createHash } from 'node:crypto';

/** A tiny cookie jar: name=value pairs from Set-Cookie, sent back as one Cookie header. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();
  take(res: Response): void {
    const all = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
    for (const c of all) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      if (i > 0) this.cookies.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
    }
  }
  header(): Record<string, string> {
    return this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {};
  }
  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

const meetsBits = (word: number, bits: number) => (bits >= 32 ? word === 0 : word >>> 0 < 2 ** (32 - bits));

/** Same puzzle as apps/web/lib/pow.ts: for each i, the first n with SHA-256("<challenge>.<i>.<n>") under `bits` leading zero bits. */
export function solvePow(p: { challenge: string; bits: number; count: number }): number[] {
  if (!(p.bits >= 1 && p.bits <= 32) || !(p.count >= 1 && p.count <= 64)) throw new Error('bad puzzle');
  const out: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const prefix = `${p.challenge}.${i}.`;
    for (let n = 0; ; n++) {
      if (n > 0xffffffff) throw new Error('no solution in range');
      const d = createHash('sha256').update(`${prefix}${n}`, 'latin1').digest();
      if (meetsBits(d.readUInt32BE(0), p.bits)) {
        out.push(n);
        break;
      }
    }
  }
  return out;
}

export async function passHumanCheck(f: typeof fetch, base: string, jar: CookieJar): Promise<'passed' | 'none' | 'pow'> {
  const res = await f(`${base}/api/human/challenge`, { method: 'POST', headers: { 'content-type': 'application/json', ...jar.header() }, body: '{}' });
  jar.take(res);
  if (res.status === 404) return 'none'; // an older build without the check
  if (!res.ok) throw new Error(`POST /api/human/challenge → ${res.status} ${(await res.text()).slice(0, 200)}`);
  const ch = (await res.json()) as { kind: string; challenge?: string; bits?: number; count?: number };
  if (ch.kind === 'none' || ch.kind === 'passed') return ch.kind;
  if (ch.kind !== 'pow' || !ch.challenge || !ch.bits || !ch.count) throw new Error(`human check "${ch.kind}" cannot be scripted: run the app with HUMAN_CHECK=pow for this step (NOTES-security.md)`);
  const solution = solvePow({ challenge: ch.challenge, bits: ch.bits, count: ch.count });
  const v = await f(`${base}/api/human/verify`, { method: 'POST', headers: { 'content-type': 'application/json', ...jar.header() }, body: JSON.stringify({ kind: 'pow', challenge: ch.challenge, solution }) });
  jar.take(v);
  if (!v.ok) throw new Error(`POST /api/human/verify → ${v.status} ${(await v.text()).slice(0, 200)}`);
  return 'pow';
}
