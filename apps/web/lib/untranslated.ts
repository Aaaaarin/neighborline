/**
 * The offline extractor (packages/agents intake/heuristic.ts, AI_MODE=fixture) cannot translate, so it
 * prefixes `summaryEn` with this marker and keeps the neighbor's own words. The UI must never show the
 * marker inside the neighbor's words: strip it and render a separate hint instead (JUDGE-PANEL-2 #3e).
 */
export const OFFLINE_UNTRANSLATED_PREFIX = '(offline mode, not translated)';

export function splitUntranslated(summary: string | undefined | null): { text: string; untranslated: boolean } {
  const s = summary ?? '';
  if (!s.startsWith(OFFLINE_UNTRANSLATED_PREFIX)) return { text: s, untranslated: false };
  return { text: s.slice(OFFLINE_UNTRANSLATED_PREFIX.length).trimStart(), untranslated: true };
}
