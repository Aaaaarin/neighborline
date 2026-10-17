import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { distTsconfigContent, distTsconfigName, distTsconfigPath } from './dist-tsconfig';

const tracked = JSON.parse(readFileSync(fileURLToPath(new URL('../tsconfig.json', import.meta.url)), 'utf8')) as { include: string[]; exclude: string[] };
const parse = (s: string) => JSON.parse(s.replace(/^\/\/.*\n/, '')) as { extends: string; include: string[]; exclude: string[] };

describe('custom NEXT_DIST_DIR never rewrites the tracked tsconfig.json', () => {
  it('the tracked tsconfig already has what Next adds for the default dist dir', () => {
    // writeConfigurationDefaults: `if (!rawConfig.include.includes(`${distDir}/types/**/*.ts`)) → rewrite`.
    expect(tracked.include).toContain('.next/types/**/*.ts');
    expect(tracked.include).toContain('next-types.d.ts');
  });

  it('names the generated file under the .next* gitignore pattern', () => {
    expect(distTsconfigName('.next-e2e')).toBe('.next-tsconfig-next-e2e.json');
    expect(distTsconfigName('.next-qa2')).toBe('.next-tsconfig-next-qa2.json');
    expect(distTsconfigName('build/out/')).toBe('.next-tsconfig-build-out.json');
    for (const d of ['.next-e2e', 'x', '../weird dir']) expect(distTsconfigName(d)).toMatch(/^\.next[^/\\]*\.json$/);
  });

  it('extends tsconfig.json, keeps its include and exclude, and adds exactly the string Next looks for', () => {
    const cfg = parse(distTsconfigContent(tracked, '.next-qa2'));
    expect(cfg.extends).toBe('./tsconfig.json');
    expect(cfg.include).toContain('.next-qa2/types/**/*.ts');
    expect(cfg.include).not.toContain('.next/types/**/*.ts');
    for (const p of tracked.include.filter((p) => p !== '.next/types/**/*.ts')) expect(cfg.include).toContain(p);
    // Next writes a default `exclude` into a config that has none; ours has one, so it never does.
    expect(cfg.exclude).toEqual(tracked.exclude);
  });

  it('uses tsconfig.json itself for the default dist dir and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nl-tsconfig-'));
    expect(distTsconfigPath(dir, '.next')).toBe('tsconfig.json');
  });

  it('writes the generated file once and leaves it untouched when nothing changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nl-tsconfig-'));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tracked));
    const name = distTsconfigPath(dir, '.next-e2e');
    expect(name).toBe('.next-tsconfig-next-e2e.json');
    const first = statSync(join(dir, name)).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    distTsconfigPath(dir, '.next-e2e');
    expect(statSync(join(dir, name)).mtimeMs).toBe(first);
    expect(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).toBe(JSON.stringify(tracked));
  });
});
