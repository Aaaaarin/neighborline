/**
 * Intake evaluation runner.
 *
 *   pnpm --filter @neighborline/agents eval                                   # fixture mode (default)
 *   pnpm --filter @neighborline/agents eval --mode oracle                     # gold labels as the model: pipeline ceiling
 *   pnpm --filter @neighborline/agents eval --mode live --provider anthropic [--model claude-sonnet-5-5]
 *   pnpm --filter @neighborline/agents eval --mode live --provider openai-compatible \
 *        --base-url http://localhost:11434/v1 --model qwen2.5:7b-instruct
 *   pnpm --filter @neighborline/agents eval --mode live --provider openai --dry-run   # mock model
 *   … [--lang vi,ht] [--set intake,adversarial,benign] [--limit 20] [--concurrency 4]
 *     [--price-in 3 --price-out 15] [--check] [--no-write] [--out file.json]
 *
 * Writes eval/results/<date>-<mode>-<model>.json and refreshes the generated block in docs/EVAL.md
 * (full, non-dry runs only). --check exits 1 when eval/thresholds.json is not met.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVAL_LANGS, EVAL_SETS, loadDataset, type EvalCase } from './dataset.js';
import { computeMetrics, type Metrics } from './metrics.js';
import { buildEvalLLM, EVAL_PROVIDERS, type EvalMode, type EvalProvider } from './providers.js';
import { renderGenerated, spliceGenerated, type ResultFile, type ResultMeta } from './report.js';
import { evalPolicy, runCase, type CaseResult } from './run-case.js';
import { checkThresholds, loadThresholds } from './thresholds.js';

const EVAL_DIR = fileURLToPath(new URL('./', import.meta.url));
const RESULTS_DIR = join(EVAL_DIR, 'results');
const DOC_PATH = fileURLToPath(new URL('../../../docs/EVAL.md', import.meta.url));

export interface CliOptions {
  mode: EvalMode;
  provider?: EvalProvider;
  model?: string;
  baseURL?: string;
  langs: string[] | null;
  sets: string[] | null;
  limit: number | null;
  concurrency: number;
  dryRun: boolean;
  check: boolean;
  write: boolean;
  out?: string;
  priceIn?: number;
  priceOut?: number;
  quiet: boolean;
}

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined> = process.env): CliOptions {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`);
    const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    const next = argv[i + 1];
    if (inline !== undefined) flags.set(k, inline);
    else if (next !== undefined && !next.startsWith('--')) {
      flags.set(k, next);
      i++;
    } else flags.set(k, true);
  }
  const str = (k: string): string | undefined => {
    const v = flags.get(k);
    if (v === true) throw new Error(`--${k} needs a value`);
    return v;
  };
  const list = (k: string, allowed: readonly string[]): string[] | null => {
    const v = str(k);
    if (!v) return null;
    const xs = v.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = xs.filter((x) => !allowed.includes(x));
    if (bad.length) throw new Error(`--${k}: unknown ${bad.join(', ')} (allowed: ${allowed.join(', ')})`);
    return xs;
  };
  const num = (k: string): number | undefined => {
    const v = str(k);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${k} must be a non-negative number`);
    return n;
  };
  const known = new Set(['mode', 'provider', 'model', 'base-url', 'lang', 'set', 'limit', 'concurrency', 'dry-run', 'check', 'no-write', 'out', 'price-in', 'price-out', 'quiet']);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag --${k}`);

  const mode = (str('mode') ?? 'fixture') as EvalMode;
  if (mode !== 'fixture' && mode !== 'live' && mode !== 'oracle') throw new Error('--mode must be fixture, oracle or live');
  const provider = str('provider') as EvalProvider | undefined;
  if (provider && !EVAL_PROVIDERS.includes(provider)) throw new Error(`--provider must be one of ${EVAL_PROVIDERS.join(', ')}`);
  const priceIn = num('price-in') ?? (env.EVAL_PRICE_IN ? Number(env.EVAL_PRICE_IN) : undefined);
  const priceOut = num('price-out') ?? (env.EVAL_PRICE_OUT ? Number(env.EVAL_PRICE_OUT) : undefined);
  const limit = num('limit');
  const model = str('model');
  const baseURL = str('base-url');
  const out = str('out');
  return {
    mode,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(baseURL ? { baseURL } : {}),
    langs: list('lang', EVAL_LANGS),
    sets: list('set', EVAL_SETS),
    limit: limit ?? null,
    concurrency: Math.max(1, Math.floor(num('concurrency') ?? (mode === 'live' ? 4 : 1))),
    dryRun: flags.has('dry-run'),
    check: flags.has('check'),
    write: !flags.has('no-write'),
    ...(out ? { out } : {}),
    ...(priceIn !== undefined && Number.isFinite(priceIn) ? { priceIn } : {}),
    ...(priceOut !== undefined && Number.isFinite(priceOut) ? { priceOut } : {}),
    quiet: flags.has('quiet'),
  };
}

async function pool<T, R>(items: readonly T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export const goldIndex = (cases: readonly EvalCase[]) =>
  new Map(cases.map((c) => [c.id, { payout: c.gold.payout !== null, amount: c.gold.requestedAmountCents !== undefined, injection: c.expect.injection, impersonation: c.expect.impersonation }]));

export interface EvalRun {
  result: ResultFile;
  thresholdFailures: string[];
}

export async function runEval(opts: CliOptions, log: (s: string) => void = () => {}): Promise<EvalRun> {
  const dataset = loadDataset();
  let cases = dataset.cases;
  if (opts.langs) cases = cases.filter((c) => opts.langs?.includes(c.lang));
  if (opts.sets) cases = cases.filter((c) => opts.sets?.includes(c.set));
  if (opts.limit !== null) cases = cases.slice(0, opts.limit);

  const evalLLM = await buildEvalLLM({ mode: opts.mode, dryRun: opts.dryRun, cases, ...(opts.provider ? { provider: opts.provider } : {}), ...(opts.model ? { model: opts.model } : {}), ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
  const policy = evalPolicy();
  const started = performance.now();
  let done = 0;
  let results: CaseResult[];
  try {
    results = await pool(cases, opts.concurrency, async (c) => {
      const r = await runCase(evalLLM.llm, c, policy);
      done++;
      if (done % 25 === 0 || done === cases.length) log(`  ${done}/${cases.length}`);
      return r;
    });
  } finally {
    await evalLLM.close();
  }
  const prices = opts.priceIn !== undefined && opts.priceOut !== undefined ? { inPerM: opts.priceIn, outPerM: opts.priceOut } : null;
  const metrics: Metrics = computeMetrics(results, goldIndex(cases), prices ? { priceInPerM: prices.inPerM, priceOutPerM: prices.outPerM } : {});
  let gitCommit: string | null = null;
  try {
    gitCommit = execSync('git rev-parse HEAD', { cwd: EVAL_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  const meta: ResultMeta = {
    date: new Date().toISOString(),
    mode: opts.mode,
    provider: evalLLM.provider,
    model: evalLLM.model,
    label: evalLLM.label,
    dryRun: evalLLM.dryRun,
    measures: evalLLM.measures,
    datasetSha256: dataset.sha256,
    datasetCases: cases.length,
    filters: { langs: opts.langs, sets: opts.sets, limit: opts.limit },
    gitCommit,
    node: process.version,
    durationMs: Math.round(performance.now() - started),
    prices,
  };
  const result: ResultFile = { meta, metrics, cases: results };
  const thresholdFailures = opts.check ? checkThresholds(metrics, loadThresholds(), opts.mode) : [];
  return { result, thresholdFailures };
}

/** Readable diffs: meta and metrics pretty-printed, one line per case. */
export const serializeResult = (r: ResultFile): string =>
  `{\n"meta": ${JSON.stringify(r.meta, null, 2)},\n"metrics": ${JSON.stringify(r.metrics)},\n"cases": [\n${r.cases.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`;

export const resultFileName = (m: ResultMeta): string => `${m.date.slice(0, 10)}-${m.dryRun ? 'dryrun' : m.mode}-${m.label}.json`;

export function loadResults(dir: string = RESULTS_DIR): ResultFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ResultFile);
}

function summary(r: ResultFile): string {
  const m = r.metrics;
  const p = (x: { rate: number | null; k: number; n: number }) => (x.rate === null ? 'n/a' : `${(x.rate * 100).toFixed(1)}% (${x.k}/${x.n})`);
  return [
    `Measured: ${r.meta.measures}`,
    `cases ${m.pipeline.all.n} · schema-valid 1st output ${p(m.pipeline.all.schemaValidFirstOutput)} · repaired ${p(m.pipeline.all.repaired)} · re-asked ${p(m.pipeline.all.reAsked)}`,
    `intake: category ${p(m.fields.intake.category)} · household ${p(m.fields.intake.household)} · payout ${p(m.fields.intake.payout)} · status ${p(m.fields.intake.status)}`,
    `injection caught ${p(m.injection.catch)} · benign flagged ${p(m.injection.falsePositiveBenign)}`,
    `impersonation blocked ${p(m.impersonation.catch)} (rail alone ${p(m.impersonation.catchRailOnly)}) · legit flagged ${p(m.impersonation.falsePositive)}`,
    `payout hallucination ${p(m.safety.payoutHallucination)} · amount over cap ${p(m.safety.amountOverCap)}`,
    `latency p50/p95 model ${m.latency.modelMsP50}/${m.latency.modelMsP95} ms · ${m.tokens.callsPerCase} calls, ~${m.tokens.inputPerCase}+${m.tokens.outputPerCase} tokens per intake`,
  ].join('\n');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const log = opts.quiet ? () => {} : (s: string) => console.log(s);
  log(`neighborline eval · mode=${opts.mode}${opts.dryRun ? ' (dry run, mock model)' : ''}${opts.provider ? ` · provider=${opts.provider}` : ''}`);
  const { result, thresholdFailures } = await runEval(opts, log);
  console.log(summary(result));

  if (opts.write) {
    const full = !opts.langs && !opts.sets && opts.limit === null;
    const file = opts.out ?? join(RESULTS_DIR, opts.dryRun ? 'dryrun' : '', resultFileName(result.meta));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serializeResult(result));
    console.log(`wrote ${file}`);
    if (full && !opts.dryRun && !opts.out) {
      const all = loadResults().filter((r) => r.meta.datasetSha256 === result.meta.datasetSha256 && r.meta.filters.langs === null && r.meta.filters.sets === null && r.meta.filters.limit === null);
      const doc = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, 'utf8') : '# Neighborline AI evaluation\n';
      writeFileSync(DOC_PATH, spliceGenerated(doc, renderGenerated(all, loadDataset().cases)));
      console.log(`updated ${DOC_PATH}`);
    }
  }
  if (opts.check) {
    if (thresholdFailures.length) {
      console.error(`eval thresholds FAILED:\n${thresholdFailures.map((f) => `  - ${f}`).join('\n')}`);
      process.exitCode = 1;
    } else console.log('eval thresholds met');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
