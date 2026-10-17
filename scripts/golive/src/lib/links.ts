/**
 * Markdown link checker for the repo's docs: every relative link and image must point at a file that exists, and
 * every `#anchor` at a heading (GitHub's slug rules) in the target file. External links are not fetched (CI-safe);
 * the hosted URL is checked separately by finalize-docs.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

export interface BrokenLink {
  file: string;
  line: number;
  target: string;
  reason: string;
}

/** GitHub's heading → anchor: lowercase, drop punctuation except - and _, spaces → -, numbered duplicates. */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function anchorsOf(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const html = /<a\s+(?:name|id)="([^"]+)"/.exec(line);
    if (html) out.add(html[1]!);
    if (!m) continue;
    const base = slugify(m[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

/** Links outside code fences and inline code: [text](target), ![alt](target), <img src="target">. */
export function linksOf(markdown: string): Array<{ line: number; target: string }> {
  const out: Array<{ line: number; target: string }> = [];
  let fence = false;
  markdown.split('\n').forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ line: i + 1, target: m[1]! });
    for (const m of line.matchAll(/<img[^>]+src="([^"]+)"/g)) out.push({ line: i + 1, target: m[1]! });
  });
  return out;
}

export function checkLinks(repo: string, files: string[]): BrokenLink[] {
  const broken: BrokenLink[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchors = (abs: string) => {
    if (!anchorCache.has(abs)) anchorCache.set(abs, anchorsOf(readFileSync(abs, 'utf8')));
    return anchorCache.get(abs)!;
  };
  for (const file of files) {
    const abs = join(repo, file);
    if (!existsSync(abs)) continue;
    for (const { line, target } of linksOf(readFileSync(abs, 'utf8'))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue; // http(s), mailto, …
      const [pathPart, anchor] = target.split('#', 2) as [string, string | undefined];
      const decoded = decodeURIComponent(pathPart);
      const dest = decoded ? normalize(join(dirname(abs), decoded)) : abs;
      if (relative(repo, dest).startsWith('..')) continue; // e.g. ../../issues on GitHub
      if (!existsSync(dest)) {
        broken.push({ file, line, target, reason: 'no such file' });
        continue;
      }
      if (anchor && /\.md$/i.test(dest) && statSync(dest).isFile() && !anchors(dest).has(anchor.toLowerCase()) && !anchors(dest).has(anchor)) {
        broken.push({ file, line, target, reason: `no heading for #${anchor}` });
      }
    }
  }
  return broken;
}
