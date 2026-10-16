/**
 * Cron dispatcher (Render Cron Job `neighborline-scheduler`, start command `node dist/scheduler.js`).
 *
 * Render Workflows has no native schedules yet (docs: "use a cron job"), so this ~1 s process starts
 * the due task runs through the Render API and exits. It holds ONLY a Render API key: no PayPal, LLM
 * or internal HMAC secret. All real work (and retries) happens in the workflow runs.
 *
 * Every tick re-dispatches the jobs for the current hour/day with an idempotency key, and Render returns
 * the existing run for a repeated key (24 h window), so ticking every 10–15 min is safe and a missed
 * tick heals itself on the next one.
 *
 * Env:
 *   RENDER_API_KEY           required (Account settings → API keys)
 *   WORKFLOW_SLUG            render.yaml wires it from the workflow service; default neighborline-workflows
 *   RECONCILE_HOUR_UTC       default 10 (03:00 PDT / 02:00 PST)
 *   REPORT_REFRESH_EVERY_N_PAYOUTS  default 5
 *   DEMO_RESET_HOUR_UTC      optional, hosted demo only: reseed the demo database once a day at this hour
 *   KEEP_WARM_URL            optional, e.g. https://neighborline.onrender.com/api/health (free web plan only)
 *   DISPATCH_MODE=inline     fallback without Workflows: run the task code in this process
 *                            (then also needs NEIGHBORLINE_INTERNAL_SECRET + NEIGHBORLINE_BASE_URL)
 *
 * Manual: `node dist/scheduler.js --task nightlyReconcile` starts one task now (fresh idempotency key).
 */
import { Render } from '@renderinc/sdk';
import { dueJobs, type DueJob, type TaskName } from './policy.js';

const TASKS: readonly TaskName[] = ['nightlyReconcile', 'unclaimedSweep', 'refreshReport', 'nightlyDemoReset'];

function intEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} must be an integer in [${min}, ${max}]`);
  return n;
}

async function keepWarm(url: string): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { 'user-agent': 'neighborline-keepwarm' } });
    console.log(JSON.stringify({ event: 'keep_warm', status: res.status, ms: Date.now() - started }));
  } catch (err) {
    // Never fail the tick for keep-warm; the dispatch result is what matters.
    console.log(JSON.stringify({ event: 'keep_warm_failed', error: String(err), ms: Date.now() - started }));
  }
}

async function runJobsInline(jobs: DueJob[]): Promise<number> {
  const [{ runInline }, { nightlyReconcile }, { unclaimedSweep }, { refreshReport }, { nightlyDemoReset }] = await Promise.all([
    import('./inline.js'),
    import('./tasks/reconcile.js'),
    import('./tasks/unclaimed.js'),
    import('./tasks/report.js'),
    import('./tasks/demo.js'),
  ]);
  let failed = 0;
  for (const job of jobs) {
    try {
      const result =
        job.task === 'nightlyReconcile'
          ? await runInline(nightlyReconcile)
          : job.task === 'unclaimedSweep'
            ? await runInline(unclaimedSweep)
            : job.task === 'nightlyDemoReset'
              ? await runInline(nightlyDemoReset)
              : await runInline(refreshReport, (job.input[0] ?? {}) as Parameters<typeof refreshReport.func>[1]);
      console.log(JSON.stringify({ event: 'inline_done', task: job.task, result }));
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ event: 'inline_failed', task: job.task, error: String(err) }));
    }
  }
  return failed;
}

function manualJob(argv: string[]): DueJob | null {
  const i = argv.indexOf('--task');
  if (i === -1) return null;
  const name = argv[i + 1] as TaskName | undefined;
  if (!name || !TASKS.includes(name)) throw new Error(`--task must be one of ${TASKS.join(', ')}`);
  const input = name === 'refreshReport' ? [{ force: true, reason: 'manual' }] : [];
  return { task: name, input, idempotencyKey: `manual:${name}:${Date.now()}` };
}

async function main(): Promise<void> {
  const slug = process.env.WORKFLOW_SLUG?.trim() || 'neighborline-workflows';
  const manual = manualJob(process.argv.slice(2));
  const jobs = manual
    ? [manual]
    : dueJobs(new Date(), {
        reconcileHourUtc: intEnv('RECONCILE_HOUR_UTC', 10, 0, 23),
        reportEveryNPayouts: intEnv('REPORT_REFRESH_EVERY_N_PAYOUTS', 5, 1, 10_000),
        demoResetHourUtc: process.env.DEMO_RESET_HOUR_UTC ? intEnv('DEMO_RESET_HOUR_UTC', 11, 0, 23) : null,
      });

  const keepWarmUrl = process.env.KEEP_WARM_URL?.trim();
  const warm = keepWarmUrl ? keepWarm(keepWarmUrl) : Promise.resolve();

  if (process.env.DISPATCH_MODE === 'inline') {
    // Fallback without Render Workflows (see inline.ts). No Render idempotency here, so hourly/daily
    // jobs run only on the first tick of their period; the app endpoints are idempotent anyway.
    const firstTick = manual !== null || new Date().getUTCMinutes() < 15;
    const failedInline = firstTick ? await runJobsInline(jobs) : 0;
    await warm;
    if (failedInline > 0) process.exitCode = 1;
    return;
  }

  if (!process.env.RENDER_API_KEY) throw new Error('RENDER_API_KEY is not set (or set DISPATCH_MODE=inline)');
  const render = new Render();
  let failed = 0;
  for (const job of jobs) {
    const taskSlug = `${slug}/${job.task}`;
    try {
      const run = await render.workflows.startTask(taskSlug, job.input, { idempotencyKey: job.idempotencyKey });
      console.log(JSON.stringify({ event: 'dispatched', task: taskSlug, key: job.idempotencyKey, taskRunId: run.taskRunId }));
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ event: 'dispatch_failed', task: taskSlug, key: job.idempotencyKey, error: String(err) }));
    }
  }
  await warm;
  if (failed > 0) process.exitCode = 1; // the cron run shows as failed in the dashboard
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
