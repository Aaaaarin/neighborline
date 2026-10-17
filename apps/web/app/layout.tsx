import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource-variable/atkinson-hyperlegible-mono/index.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Neighborline — a hotline for mutual aid', template: '%s · Neighborline' },
  description:
    'Leave a voice note in any language. Two neighbors approve, each with a passkey. The money lands in PayPal or Venmo in minutes, not days.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eff1ee' },
    { media: '(prefers-color-scheme: dark)', color: '#141a24' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so Next.js can put this request's CSP
  // nonce (middleware.ts) on its scripts. A prerendered page would carry no nonce and be blocked.
  await headers();
  return (
    <html lang="en">
      {/* Text-face preloads are per page (lib/fonts.ts: /report and /), not global (QA-2 P3). */}
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
