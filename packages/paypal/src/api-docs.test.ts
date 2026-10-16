/**
 * API.md must document every export of every public entry point (package.json "exports"). Adding an export without
 * documenting it fails here, so the published reference cannot drift from the code.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { exports: Record<string, string>; publishConfig: { exports: Record<string, unknown> } };
const entries = Object.entries(pkg.exports).filter(([k]) => k !== './package.json');
const doc = readFileSync(new URL('API.md', root), 'utf8');
const inCode = new Set([...doc.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1]!.match(/[A-Za-z_$][\w$]*/g) ?? []));

const program = ts.createProgram(
  entries.map(([, f]) => new URL(f, root).pathname),
  { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, strict: true, skipLibCheck: true, noEmit: true },
);
const checker = program.getTypeChecker();

describe('API.md', () => {
  it('covers the same subpaths in the workspace and the published package', () => {
    expect(Object.keys(pkg.publishConfig.exports).sort()).toEqual(Object.keys(pkg.exports).sort());
  });

  it.each(entries)('documents every export of %s', (subpath, file) => {
    const sf = program.getSourceFile(new URL(file, root).pathname)!;
    const names = checker.getExportsOfModule(checker.getSymbolAtLocation(sf)!).map((s) => s.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !inCode.has(n)), `undocumented exports of ${subpath}`).toEqual([]);
    if (subpath !== '.') expect(doc).toContain(`@neighborline/paypal/${subpath.slice(2)}`);
  });
});
