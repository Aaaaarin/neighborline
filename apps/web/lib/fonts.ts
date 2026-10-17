import { preload } from 'react-dom';

/** The Latin text faces of globals.css (served from /public/fonts). */
export const TEXT_FONTS = ['be-vietnam-pro-latin-400-normal.woff2', 'be-vietnam-pro-latin-600-normal.woff2', 'literata-latin-opsz-normal.woff2'] as const;

/**
 * Preload the text faces on pages whose first paint must not reflow when they arrive (/report: CLS 0,
 * QA-1). Per page, not in the root layout: a global preload made Chromium warn "preloaded but not used
 * within a few seconds" on pages such as /organizer (QA-2 P3). React hoists these links into <head>.
 */
export function preloadTextFonts(): void {
  for (const f of TEXT_FONTS) preload(`/fonts/${f}`, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
}
