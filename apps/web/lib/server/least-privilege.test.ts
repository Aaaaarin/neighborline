/**
 * Judged claim (SPEC §2.2): "the intake agent cannot move money; only the approval service holds
 * Payouts credentials and only executes with a valid two-person approval record".
 * Enforced structurally, and this test fails the build if anyone wires a shortcut:
 *   1. No production module of the web app imports a Payouts-capable PayPal API, calls the Payouts REST
 *      path, reads PAYPAL_PAYOUTS_* env, or creates/updates payout batches in the database.
 *   2. From the approver package the web app imports ONLY `@neighborline/approver/protocol`
 *      (request shapes + HMAC signing), and that module itself has no PayPal or database code.
 *   3. In the whole repo, apps/approver is the only runtime code that constructs `new PayoutsApi(`
 *      (besides packages/paypal itself, its MCP server, and tests).
 *   4. The intake path (engine/intake.ts and everything it imports at runtime) never reaches the
 *      approval client, and packages/agents (all AI) does not depend on @neighborline/paypal at all.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = resolve(WEB, '../..');
/** Names that can move money out (Payouts) or build a full client that includes Payouts. */
const MONEY_OUT = ['PayoutsApi', 'createPayPal', 'createPayPalFromEnv', 'buildPayoutRequest'];
/** Database writes that belong to the approver only (it creates the batch right before PayPal). */
const APPROVER_ONLY_DB = ['createBatch', 'setPaypalItemId'];
/**
 * Seeding fictional demo history (Ana's earlier payout, ids SEEDITEM…) writes a batch row directly;
 * it never calls PayPal and runs only when a fresh demo database is created.
 */
const SEED_ONLY = ['lib/server/engine/demo-extras.ts'];

function walk(dir: string, out: string[] = [], opts: { skipDirs?: string[] } = {}): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name.startsWith('.')) continue;
    if (opts.skipDirs?.includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out, opts);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/test-helpers\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Production code of the web app: app/, lib/, components/, middleware and config at the root. */
function webProductionFiles(): string[] {
  const files = ['app', 'lib', 'components'].flatMap((d) => walk(join(WEB, d)));
  for (const f of readdirSync(WEB)) if (/\.(ts|mjs|js)$/.test(f) && statSync(join(WEB, f)).isFile()) files.push(join(WEB, f));
  return files;
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

/** Offences in one web production file. */
function offences(file: string, src: string): string[] {
  const rel = relative(WEB, file);
  const out: string[] = [];
  for (const imp of runtimeImports(src)) {
    if (imp.spec.startsWith('@neighborline/paypal')) {
      if (imp.spec !== '@neighborline/paypal') out.push(`${rel} imports ${imp.spec}`);
      for (const n of imp.names) if (n === '*' || MONEY_OUT.includes(n)) out.push(`${rel} imports ${n} from @neighborline/paypal`);
    }
    if (imp.spec.startsWith('@neighborline/approver') && imp.spec !== '@neighborline/approver/protocol') out.push(`${rel} imports ${imp.spec}`);
    if (imp.spec.startsWith('@neighborline/db')) {
      for (const n of imp.names) if ((n === '*' || APPROVER_ONLY_DB.includes(n)) && !(SEED_ONLY.includes(rel) && n === 'createBatch')) out.push(`${rel} imports ${n} from @neighborline/db`);
    }
  }
  if (/\/v1\/payments\/payouts/.test(src)) out.push(`${rel} calls the Payouts REST API directly`);
  if (/PAYPAL_PAYOUTS_/.test(src)) out.push(`${rel} reads PAYPAL_PAYOUTS_* (Payouts credentials belong to the approver process)`);
  return out;
}

describe('least privilege: only the approver process can pay', () => {
  it('no web production module can reach Payouts, its credentials, or batch creation', () => {
    const found = webProductionFiles().flatMap((f) => offences(f, readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });

  it('the web app imports only the protocol module of the approver, and that module cannot pay', () => {
    const users = webProductionFiles().filter((f) => runtimeImports(readFileSync(f, 'utf8')).some((i) => i.spec.startsWith('@neighborline/approver')));
    expect(users.map((f) => relative(WEB, f)).sort()).toEqual(['lib/server/approver-client.ts']);
    const protocol = readFileSync(join(REPO, 'apps/approver/src/protocol.ts'), 'utf8');
    expect(runtimeImports(protocol).map((i) => i.spec).sort()).toEqual(['node:crypto', 'zod']);
    expect(protocol).not.toMatch(/PayoutsApi|@neighborline\/(paypal|db)/);
  });

  it('apps/approver is the only runtime code in the repo that constructs a Payouts client', () => {
    const roots = ['apps', 'packages', 'tools', 'workflows/src', 'scripts'].map((d) => join(REPO, d));
    const builders = roots
      .flatMap((r) => walk(r, [], { skipDirs: ['test', 'e2e'] }))
      .filter((f) => /new PayoutsApi\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(REPO, f))
      // The library itself (createPayPal convenience factory + the MCP server's approval-gated tool).
      .filter((f) => !f.startsWith('packages/paypal/src/'));
    expect(builders).toEqual(['apps/approver/src/main.ts']);
  });

  it('the approver checks the record itself before it pays (hash, organizers, signatures, policy), on every rail', () => {
    const read = (f: string) => readFileSync(join(REPO, 'apps/approver/src', f), 'utf8');
    const [approver, verify, rails, manual] = ['approver.ts', 'verify.ts', 'rails.ts', 'manual.ts'].map(read) as [string, string, string, string];
    for (const step of ['approvalPayload', 'verifyApprovalRecord', 'createBatch']) expect(approver).toContain(step);
    for (const step of ['distinctApprovers', 'checkAssertions', 'contentFromRequests', 'recheckPolicy']) expect(verify).toContain(step);
    // PayPal rail and manual rail both re-verify before they act.
    expect(approver.indexOf('verifyApprovalRecord(')).toBeLessThan(approver.indexOf('this.rail.send('));
    expect(manual.indexOf('verifyApprovalRecord(')).toBeLessThan(manual.indexOf('rail.send('));
    // Only the PayPal rail calls Payouts; the manual rail has no client and no network.
    expect(rails).toContain('this.payouts.createBatch(');
    expect(rails.slice(rails.indexOf('export class ManualRail'))).not.toMatch(/payouts|fetch\(|PayPalClient/i);
  });

  it('the intake path never reaches the approval client (transitively, at runtime)', () => {
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
    const reached = [...seen].map((f) => relative(WEB, f));
    expect(reached).not.toContain('lib/server/approval-service.ts');
    expect(reached).not.toContain('lib/server/approver-client.ts');
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

  it('detects violations (self-test of the scanner)', () => {
    expect(runtimeImports(`import { PayoutsApi } from '@neighborline/paypal';`)[0]!.names).toEqual(['PayoutsApi']);
    expect(runtimeImports(`import type { PayoutsApi } from '@neighborline/paypal';`)).toEqual([]);
    expect(runtimeImports(`import * as pp from '@neighborline/paypal';`)[0]!.names).toEqual(['*']);
    expect(runtimeImports(`import { createPayPal as cp, type X } from '@neighborline/paypal';`)[0]!.names).toEqual(['createPayPal']);
    const fake = join(WEB, 'lib/server/x.ts');
    expect(offences(fake, `import { Approver } from '@neighborline/approver';`)).toHaveLength(1);
    expect(offences(fake, `import { createBatch } from '@neighborline/db';`)).toHaveLength(1);
    expect(offences(fake, `const id = process.env.PAYPAL_PAYOUTS_CLIENT_ID;`)).toHaveLength(1);
    expect(offences(fake, `import { signApproverRequest } from '@neighborline/approver/protocol';`)).toEqual([]);
  });
});
