/**
 * Lenient JSON parsing for model text. Every fix is reported so traces show that a local,
 * deterministic repair happened (no extra LLM call).
 */
export type LenientParse = { ok: true; value: unknown; fixes: string[] } | { ok: false; error: string; fixes: string[] };

export function parseJsonLenient(text: string): LenientParse {
  const fixes: string[] = [];
  let s = text.trim();
  try {
    return { ok: true, value: JSON.parse(s), fixes };
  } catch {
    /* try fixes below */
  }
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence?.[1] !== undefined) {
    s = fence[1];
    fixes.push('stripped markdown code fence');
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first > 0 || (last >= 0 && last < s.length - 1)) {
    if (first >= 0 && last > first) {
      s = s.slice(first, last + 1);
      fixes.push('removed text around the JSON object');
    }
  }
  const noTrailing = s.replace(/,\s*([}\]])/g, '$1');
  if (noTrailing !== s) {
    s = noTrailing;
    fixes.push('removed trailing commas');
  }
  try {
    return { ok: true, value: JSON.parse(s), fixes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), fixes };
  }
}
