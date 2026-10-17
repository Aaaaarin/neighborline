import { NextResponse, type NextRequest } from 'next/server';
import { humanCheckMode } from './lib/human-check-mode';
import { contentSecurityPolicy, securityHeaders } from './lib/security-headers';

/**
 * Per-request CSP nonce + security headers on every page and API response (lib/security-headers.ts).
 * The nonce travels to the app on the request's own CSP header, where Next.js picks it up and puts
 * it on the scripts it renders (the root layout reads headers(), so every page renders per request).
 */
export function middleware(req: NextRequest) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const dev = process.env.NODE_ENV !== 'production';
  const csp = contentSecurityPolicy(nonce, { dev, turnstile: humanCheckMode(process.env) === 'turnstile' });
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('content-security-policy', csp);
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  for (const [k, v] of Object.entries(securityHeaders({ dev, https: proto === 'https' }))) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
