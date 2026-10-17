/**
 * Runs the steps in order, stops at the first failure with its next action, and writes golive-out/SUMMARY.md.
 * `pending` (PayPal still processing, Transaction Search lag) and `skipped` (no key yet) never stop the run.
 */
import { join } from 'node:path';
import { makeLogger, StateStore, upsertGeneratedEnv, writeOut, type Ctx, type Step, type StepResult } from './context.js';
import { loadEnv, type Env } from './env.js';
import { spawnRunner, type Runner } from './proc.js';

export interface RunOptions {
  repo: string;
  out: string;
  steps: Step[];
  only?: string[];
  skip?: string[];
  dryRun?: boolean;
  force?: boolean;
  processEnv?: Env;
  run?: Runner;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  quiet?: boolean;
}

export interface RunReport {
  results: Array<{ step: string; title: string; result: StepResult; ms: number }>;
  stoppedAt?: string;
  summaryFile: string;
}

const ICON: Record<StepResult['status'], string> = { ok: '✓', warn: '!', pending: '…', skipped: '·', failed: '✗' };

export function selectSteps(all: Step[], only?: string[], skip?: string[]): Step[] {
  const names = new Set(all.map((s) => s.name));
  for (const n of [...(only ?? []), ...(skip ?? [])]) if (!names.has(n)) throw new Error(`unknown step "${n}" (steps: ${[...names].join(', ')})`);
  return all.filter((s) => (!only?.length || only.includes(s.name) || s.name === 'preflight') && !skip?.includes(s.name));
}

export async function runGolive(o: RunOptions): Promise<RunReport> {
  const loaded = loadEnv(o.repo, o.out, o.processEnv ?? process.env);
  let env = loaded.env;
  const log = makeLogger(o.out, () => env, o.quiet);
  const state = new StateStore(join(o.out, 'state.json'));
  const genFile = join(o.out, 'golive.env');
  const ctx: Ctx = {
    repo: o.repo,
    out: o.out,
    get env() {
      return env;
    },
    dryRun: Boolean(o.dryRun),
    force: Boolean(o.force),
    state,
    run: o.run ?? spawnRunner,
    fetch: o.fetch ?? fetch,
    now: o.now ?? (() => new Date()),
    sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    log,
    setGenerated(key, value) {
      if (o.dryRun) return;
      upsertGeneratedEnv(genFile, key, value);
      const human = loaded.source[key] === 'process' || loaded.source[key] === '.env';
      if (human && env[key] !== value) log(`  ! ${key}: generated ${value} but your ${loaded.source[key]} says ${env[key]}; yours is used. Remove it there to use the generated one.`);
      else env = { ...env, [key]: value };
    },
  } as Ctx;
  for (const c of loaded.conflicts) log(`! ${c.key}: golive.env has ${c.generated}, using ${c.used} from your environment`);

  const steps = selectSteps(o.steps, o.only, o.skip);
  const results: RunReport['results'] = [];
  let stoppedAt: string | undefined;
  log(`neighborline golive${o.dryRun ? ' (dry run: no network calls, nothing changes)' : ''} · ${steps.map((s) => s.name).join(' → ')}`);
  for (const step of steps) {
    log(`\n▶ ${step.name}: ${step.title}`);
    const started = Date.now();
    let result: StepResult;
    try {
      result = await step.run(ctx);
    } catch (err) {
      result = { status: 'failed', summary: (err as Error).message.split('\n')[0] ?? String(err), next: `Unexpected error in ${step.name}; see golive-out/golive.log. Fix, then: pnpm golive --only ${step.name}` };
      log(`  ${(err as Error).stack ?? String(err)}`);
    }
    const ms = Date.now() - started;
    results.push({ step: step.name, title: step.title, result, ms });
    if (!o.dryRun) state.setStep(step.name, result, ctx.now());
    log(`${ICON[result.status]} ${step.name}: ${result.status} · ${result.summary} (${(ms / 1000).toFixed(1)} s)`);
    if (result.next) log(`  next: ${result.next}`);
    if (result.status === 'failed') {
      stoppedAt = step.name;
      break;
    }
  }
  const summaryFile = writeOut(ctx, o.dryRun ? 'SUMMARY.dry-run.md' : 'SUMMARY.md', renderSummary(results, { stoppedAt, dryRun: Boolean(o.dryRun), at: ctx.now(), remaining: steps.slice(results.length).map((s) => s.name) }));
  log(`\nSummary: ${summaryFile}`);
  return { results, ...(stoppedAt ? { stoppedAt } : {}), summaryFile };
}

export function renderSummary(results: RunReport['results'], o: { stoppedAt: string | undefined; dryRun: boolean; at: Date; remaining: string[] }): string {
  const L = [`# pnpm golive ${o.dryRun ? '(dry run) ' : ''}· ${o.at.toISOString()}`, '', '| Step | Status | Summary | Time |', '|---|---|---|---|'];
  for (const r of results) L.push(`| ${r.step} | ${ICON[r.result.status]} ${r.result.status} | ${r.result.summary.replace(/\|/g, '\\|')} | ${(r.ms / 1000).toFixed(1)} s |`);
  const next = results.filter((r) => r.result.next);
  if (next.length) L.push('', '## Next actions', '', ...next.map((r) => `- **${r.step}:** ${r.result.next}`));
  if (o.stoppedAt) L.push('', `Stopped at **${o.stoppedAt}**. Not run: ${o.remaining.join(', ') || 'none'}. Fix the problem above, then \`pnpm golive\` again: finished parts are skipped.`);
  const outputs = results.flatMap((r) => r.result.outputs ?? []);
  if (outputs.length) L.push('', '## Files', '', ...[...new Set(outputs)].map((f) => `- \`${f}\``));
  return `${L.join('\n')}\n`;
}
