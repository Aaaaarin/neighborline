/**
 * Number grounding: every number a model writes must come from its input. Used by the
 * ReportWriter (narrative numbers ⊆ facts), the IntakeAgent (requested amount must be said by
 * the person) and the PolicyCompiler (caps must appear in the organizers' rules text).
 */

export interface FoundNumber {
  value: number;
  text: string;
  index: number;
}

// 1,350 · 1350 · 1350.50 · 94 · 83% · 2026 · "$5,000". Thousands separators only in groups of 3.
const NUM = /(?<![\p{L}\p{N}.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\p{N}])/gu;

export function extractNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const m of text.matchAll(NUM)) {
    const whole = (m[1] ?? '').replace(/,/g, '');
    const value = Number(m[2] ? `${whole}.${m[2]}` : whole);
    if (Number.isFinite(value)) out.push({ value, text: m[0], index: m.index ?? 0 });
  }
  return out;
}

/** Numbers in `output` that do not appear in `allowed` (compared numerically, so "1,350" = 1350). */
export function ungroundedNumbers(output: string, allowed: Iterable<number>): FoundNumber[] {
  const set = new Set([...allowed].map((n) => Math.round(n * 1000) / 1000));
  return extractNumbers(output).filter((n) => !set.has(Math.round(n.value * 1000) / 1000));
}

export const numbersIn = (text: string): number[] => extractNumbers(text).map((n) => n.value);

/** Sentence containing character `index`. */
export function sentenceAt(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('. ', index), text.lastIndexOf('! ', index), text.lastIndexOf('? ', index), text.lastIndexOf('\n', index));
  const ends = ['. ', '! ', '? ', '\n'].map((d) => text.indexOf(d, index)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start < 0 ? 0 : start + 1, end).trim();
}

export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
