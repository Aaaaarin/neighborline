/**
 * pnpm golive [--only a,b] [--skip a,b] [--dry-run] [--force] [--list]
 *
 * Key day in one command: preflight → sandbox-setup → sandbox-spike → live-ai → deploy-render → video-vo →
 * finalize-docs. Reads .env (and golive-out/golive.env, which it writes); stops at the first failure with the next
 * action; every step is idempotent and resumes where it stopped. docs/GOLIVE.md is the human checklist.
 */
import { join } from 'node:path';
import { REPO } from './lib/context.js';
import { runGolive } from './lib/orchestrate.js';
import { STEPS } from './steps/index.js';

export interface Cli {
  only?: string[];
  skip?: string[];
  dryRun: boolean;
  force: boolean;
  list: boolean;
  help: boolean;
  out?: string;
}

export function parseCli(argv: readonly string[]): Cli {
  const cli: Cli = { dryRun: false, force: false, list: false, help: false };
  const csv = (v: string | undefined, flag: string) => {
    if (!v || v.startsWith('--')) throw new Error(`${flag} needs a comma-separated list of steps`);
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [flag, inline] = a.split('=', 2) as [string, string | undefined];
    if (a === '--') continue;
    if (flag === '--only') cli.only = csv(inline ?? argv[++i], flag);
    else if (flag === '--skip') cli.skip = csv(inline ?? argv[++i], flag);
    else if (flag === '--out') cli.out = inline ?? argv[++i];
    else if (a === '--dry-run') cli.dryRun = true;
    else if (a === '--force') cli.force = true;
    else if (a === '--list') cli.list = true;
    else if (a === '--help' || a === '-h') cli.help = true;
    else throw new Error(`unknown argument "${a}" (try --help)`);
  }
  return cli;
}

const HELP = `pnpm golive [--only step,...] [--skip step,...] [--dry-run] [--force] [--list]

Steps (in order): ${STEPS.map((s) => s.name).join(' → ')}
  --dry-run   print what each step would do; no network calls, no changes (works with zero keys)
  --force     redo parts that already succeeded (new sandbox run id, rebuild the video, redeploy)
  --only      run just these steps (preflight always runs first)
Outputs: golive-out/ (git-ignored): SUMMARY.md, SANDBOX_EVIDENCE.md, golive.env (ids to paste), golive.log.
Human checklist: docs/GOLIVE.md`;

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) return void console.log(HELP);
  if (cli.list) return void console.log(STEPS.map((s) => `${s.name.padEnd(14)} ${s.title}`).join('\n'));
  const report = await runGolive({
    repo: REPO,
    out: cli.out ?? process.env.GOLIVE_OUT ?? join(REPO, 'golive-out'),
    steps: STEPS,
    ...(cli.only ? { only: cli.only } : {}),
    ...(cli.skip ? { skip: cli.skip } : {}),
    dryRun: cli.dryRun,
    force: cli.force,
  });
  process.exitCode = report.stoppedAt ? 1 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
