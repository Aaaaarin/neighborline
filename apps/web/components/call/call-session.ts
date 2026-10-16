import type { Lang } from '@neighborline/core';
import { ApiError } from '@/lib/api';
import type { UiStrings } from '@/lib/i18n';

const SESSION_KEY = 'neighborline.call.v1';

/** sessionStorage can throw (private mode, blocked storage): the page must work without it. */
export const saved = {
  get(): string | null {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')?.requestId ?? null;
    } catch {
      return null;
    }
  },
  set(requestId: string | null) {
    try {
      if (requestId) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ requestId }));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* not persisted; a refresh starts over */
    }
  },
};

/** Errors give direction, in the neighbor's language. Server detail is English, so only English speakers see it verbatim. */
export function errorText(e: unknown, t: UiStrings, lang: Lang): string {
  if (!(e instanceof ApiError)) return t.offline;
  if (e.status === 400 && /2000|too long|at most/i.test(e.message)) return t.tooLong;
  if (lang === 'en' && e.status < 500) return e.message;
  return t.failed;
}

