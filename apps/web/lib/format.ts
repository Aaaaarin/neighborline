import type { Lang } from '@neighborline/core';

/** "$150" for whole dollars, "$12.50" otherwise. Cents in, string out. */
export function money(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const rem = Math.abs(cents % 100);
  const whole = dollars.toLocaleString('en-US');
  return rem === 0 ? `$${whole}` : `$${whole}.${String(rem).padStart(2, '0')}`;
}

/** Stopwatch text: 0:33.2 */
export function stopwatch(ms: number): string {
  const safe = Math.max(0, ms);
  const totalTenths = Math.floor(safe / 100);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
}

/** Offset label for timeline rows: +0:03.1 */
export function offset(ms: number): string {
  return `+${stopwatch(ms)}`;
}

/** "1 min 12 s" / "48 s" */
export function duration(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

/** Shorten a long PayPal id for display: 7XK41923…3F2A */
export function shortId(id: string | undefined, head = 8, tail = 4): string {
  if (!id) return '';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Eastside is in Portland, OR: show every clock in local time there (also keeps SSR and browser in agreement). */
export const GROUP_TZ = 'America/Los_Angeles';

export function clockTime(iso: string, locale = 'en-US'): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: GROUP_TZ });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: GROUP_TZ });
}

export const LANGUAGE_NAMES: Record<Lang, { native: string; en: string }> = {
  en: { native: 'English', en: 'English' },
  es: { native: 'Español', en: 'Spanish' },
  vi: { native: 'Tiếng Việt', en: 'Vietnamese' },
  ht: { native: 'Kreyòl ayisyen', en: 'Haitian Creole' },
  zh: { native: '中文', en: 'Chinese' },
  ar: { native: 'العربية', en: 'Arabic' },
  fr: { native: 'Français', en: 'French' },
  tl: { native: 'Tagalog', en: 'Tagalog' },
  ko: { native: '한국어', en: 'Korean' },
  ru: { native: 'Русский', en: 'Russian' },
};

export function walletLabel(wallet: 'PAYPAL' | 'VENMO'): string {
  return wallet === 'VENMO' ? 'Venmo' : 'PayPal';
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
