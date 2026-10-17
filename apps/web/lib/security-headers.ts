/**
 * Security headers for every response (QA P2-10), applied by middleware.ts.
 *
 * CSP is nonce-based with 'strict-dynamic': Next.js puts the per-request nonce on its own scripts
 * (it reads it from the CSP request header), and scripts those trusted scripts load (the PayPal JS
 * SDK, which DonateForm injects) inherit trust. The PayPal/Venmo host list is kept for browsers
 * without strict-dynamic and for frames, images, fonts and XHR the SDK makes. No inline event
 * handlers, no eval in production.
 *
 * Cloudflare Turnstile (the human check, lib/human-check-mode.ts) adds challenges.cloudflare.com to
 * script-src and frame-src, and only when Turnstile is the active check; otherwise the CSP does not
 * mention it.
 */
import { TURNSTILE_ORIGIN } from './human-check-mode';

export const PAYPAL_HOSTS = ['https://www.paypal.com', 'https://*.paypal.com', 'https://*.paypalobjects.com', 'https://*.venmo.com'];

export function contentSecurityPolicy(nonce: string, opts: { dev: boolean; turnstile?: boolean }): string {
  const pp = PAYPAL_HOSTS.join(' ');
  const ts = opts.turnstile ? ` ${TURNSTILE_ORIGIN}` : '';
  const d: Record<string, string> = {
    'default-src': "'self'",
    'script-src': `'self' 'nonce-${nonce}' 'strict-dynamic' ${pp}${ts}${opts.dev ? " 'unsafe-eval'" : ''}`,
    // React style attributes and the PayPal SDK's injected styles need inline styles; no inline script.
    'style-src': `'self' 'unsafe-inline' ${pp}`,
    'img-src': `'self' data: blob: ${pp}`,
    'font-src': `'self' data: ${pp}`,
    'connect-src': `'self' ${pp}${opts.dev ? ' ws: wss:' : ''}`,
    'frame-src': `${pp}${ts}`,
    'media-src': "'self' blob: data:",
    'worker-src': "'self' blob:",
    'manifest-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': `'self' ${pp}`,
    'frame-ancestors': "'none'",
  };
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v}`);
  if (!opts.dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function securityHeaders(opts: { dev: boolean; https: boolean }): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    // Voice notes need the microphone; organizers need passkeys; nothing else is used.
    'permissions-policy': 'microphone=(self), camera=(), geolocation=(), payment=(self "https://www.paypal.com"), publickey-credentials-get=(self), publickey-credentials-create=(self), usb=(), interest-cohort=()',
    // PayPal's checkout popup talks back to its opener, so popups keep it; nothing else does.
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    ...(opts.https && !opts.dev ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
  };
}
