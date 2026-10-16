/**
 * The organizer's free-text decline note, in the neighbor's language. The agents' translateWithCheck
 * translates it and back-translates it, and every fact in the note (amounts, emails, handles, phone
 * numbers, numbers) must survive both ways; otherwise, and always in fixture mode, the neighbor gets the
 * note as written with a line in their own language saying it is in English and offering help
 * (templates.declined). Translations are cached per (language, note), so the preview the organizer saw
 * and the message that is sent are the same text.
 */
import type { Lang } from '@neighborline/core';
import { detectLang, noteFacts, translateWithCheck } from '@neighborline/agents';
import type { LocalizedNote } from '../fixtures/templates';
import { log, errorText } from '../log';
import type { BaseCtx } from './context';

type Ctx = Pick<BaseCtx, 'agents'>;

const MAX_CACHE = 200;
const cache = new Map<string, LocalizedNote>();

const keyOf = (lang: Lang, note: string) => `${lang}\u0000${note}`;

function remember(key: string, v: LocalizedNote): LocalizedNote {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, v);
  return v;
}

/**
 * `translate: false` (the live preview, refreshed as the organizer types): never calls a model; returns
 * the cached translation, or `pending` so the preview says what will happen on send.
 */
export async function localizeDeclineNote(ctx: Ctx, lang: Lang, note: string | undefined, opts: { translate?: boolean } = {}): Promise<LocalizedNote | undefined> {
  const n = note?.trim();
  if (!n || lang === 'en') return undefined;
  if (detectLang(n, 'en') === lang) return { text: n, translated: false, alreadyInLanguage: true };
  const key = keyOf(lang, n);
  const hit = cache.get(key);
  if (hit) return hit;
  const live = ctx.agents.providers.mode === 'live';
  if (live && opts.translate === false) return { text: n, translated: false, pending: true };
  try {
    const r = await translateWithCheck(ctx.agents.providers.llm, {
      text: n,
      targetLang: lang,
      facts: noteFacts(n),
      tone: 'kind, plain and respectful; this explains why a request for money was declined',
    });
    if (r.translated) return remember(key, { text: r.text, translated: true, ...(r.backTranslation ? { backTranslation: r.backTranslation } : {}) });
    if (live && r.check && !r.check.ok) log.warn('decline_note.fact_check_failed', { lang, missing: r.check.missingInTranslation.length + r.check.missingInBackTranslation.length });
    return remember(key, { text: n, translated: false });
  } catch (err) {
    log.warn('decline_note.translate_failed', { lang, error: errorText(err) });
    return { text: n, translated: false };
  }
}
