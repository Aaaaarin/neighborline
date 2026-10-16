/**
 * Judged claim (SPEC §2.2): "the intake agent cannot move money". Enforced structurally:
 *   1. Only lib/server/approval-service.ts may construct a PayPal Payouts client.
 *   2. The intake path (engine/intake.ts and everything it imports at runtime) never reaches it.
 *   3. packages/agents (all AI) does not depend on @neighborline/paypal at all.
 * Fails the build if anyone wires a shortcut.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = resolve(WEB, '../..');
const APPROVAL_SERVICE = join(WEB, 'lib/server/approval-service.ts');
/** Names that can move money out (Payouts) or build a full client that includes Payouts. */
const MONEY_OUT = ['PayoutsApi', 'createPayPal', 'createPayPalFromEnv', 'buildPayoutRequest'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Runtime (non-type) imports of a module: [specifier, imported names | '*']. */
function runtimeImports(src: string): Array<{ spec: string; names: string[] }> {
  const out: Array<{ spec: string; names: string[] }> = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of src.matchAll(re)) {
    if (m[1]) continue; // import type … — erased at compile time
    const spec = m[3] ?? m[4] ?? m[5] ?? m[6]!;
    const clause = m[2] ?? '*';
    const names = clause.includes('* as') || !clause.includes('{')
      ? ['*']
      : clause
          .replace(/^[^{]*\{/, '')
          .replace(/\}.*$/, '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith('type '))
          .map((s) => s.split(/\s+as\s+/)[0]!.trim());
    if (names.length) out.push({ spec, names });
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(WEB, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

describe('least privilege: only the approval service can pay', () => {
  const files = walk(WEB);

  it('no module except approval-service.ts imports a Payouts-capable PayPal API', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === APPROVAL_SERVICE) continue;
      const src = readFileSync(f, 'utf8');
      for (const imp of runtimeImports(src)) {
        if (!imp.spec.startsWith('@neighborline/paypal')) continue;
        if (imp.spec !== '@neighborline/paypal') offenders.push(`${relative(WEB, f)} imports ${imp.spec}`);
        for (const n of imp.names) if (n === '*' || MONEY_OUT.includes(n)) offenders.push(`${relative(WEB, f)} imports ${n}`);
      }
      if (/\/v1\/payments\/payouts/.test(src)) offenders.push(`${relative(WEB, f)} calls the Payouts REST API directly`);
    }
    expect(offenders).toEqual([]);
    // …and the approval service really is the one that does.
    expect(readFileSync(APPROVAL_SERVICE, 'utf8')).toMatch(/new PayoutsApi\(/);
  });

  it('the intake path never reaches the approval service (transitively, at runtime)', () => {
    const start = join(WEB, 'lib/server/engine/intake.ts');
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const imp of runtimeImports(readFileSync(f, 'utf8'))) {
        const r = resolveLocal(f, imp.spec);
        if (r) stack.push(r);
      }
    }
    expect([...seen].map((f) => relative(WEB, f))).not.toContain('lib/server/approval-service.ts');
    expect(seen.size).toBeGreaterThan(3);
    // The intake context type has no approval service in it.
    expect(readFileSync(start, 'utf8')).toMatch(/type BaseCtx as Ctx/);
    expect(readFileSync(join(WEB, 'lib/server/engine/context.ts'), 'utf8')).toMatch(/export type BaseCtx = Omit<Ctx, 'approvals'>/);
  });

  it('the AI agents package does not depend on PayPal Payouts at all', () => {
    const agents = walk(join(REPO, 'packages/agents/src'));
    const pkg = JSON.parse(readFileSync(join(REPO, 'packages/agents/package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    expect(Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.devDependencies })).not.toContain('@neighborline/paypal');
    const hits = agents.filter((f) => /@neighborline\/paypal|PayoutsApi|\/v1\/payments\/payouts/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(REPO, f))).toEqual([]);
  });

  it('detects a violation (self-test of the scanner)', () => {
    expect(runtimeImports(`import { PayoutsApi } from '@neighborline/paypal';`)[0]!.names).toEqual(['PayoutsApi']);
    expect(runtimeImports(`import type { PayoutsApi } from '@neighborline/paypal';`)).toEqual([]);
    expect(runtimeImports(`import * as pp from '@neighborline/paypal';`)[0]!.names).toEqual(['*']);
    expect(runtimeImports(`import { createPayPal as cp, type X } from '@neighborline/paypal';`)[0]!.names).toEqual(['createPayPal']);
  });
});
