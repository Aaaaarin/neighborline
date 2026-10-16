import type { Metadata, Viewport } from 'next';
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
    'Leave a voice note in any language. Two neighbors approve. The money lands in PayPal or Venmo in about 90 seconds.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eff1ee' },
    { media: '(prefers-color-scheme: dark)', color: '#141a24' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
