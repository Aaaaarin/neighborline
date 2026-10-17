/** `pnpm --filter @neighborline/golive check-links`: relative links and anchors in every tracked Markdown file. */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO } from './lib/context.js';
import { checkLinks } from './lib/links.js';

/** `git ls-files` Markdown; outside a git checkout, every *.md under `repo` except node_modules and dot-dirs. */
export function trackedMarkdown(repo: string): string[] {
  try {
    return execFileSync('git', ['ls-files', '*.md'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter((f) => f && !f.includes('node_modules/'));
  } catch {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) out.push(relative(repo, p));
      }
    };
    walk(repo);
    return out;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const files = trackedMarkdown(REPO);
  const broken = checkLinks(REPO, files);
  for (const b of broken) console.log(`${b.file}:${b.line}  ${b.target}  (${b.reason})`);
  console.log(`${files.length} Markdown files, ${broken.length} broken link(s)`);
  process.exitCode = broken.length ? 1 : 0;
}
