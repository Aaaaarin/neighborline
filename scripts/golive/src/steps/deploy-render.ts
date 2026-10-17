/**
 * deploy-render: the Render side, through Render's API (RENDER_API_KEY). Idempotent and resumable:
 *   1. validate render.yaml server-side (POST /blueprints/validate) and find the Blueprint's `neighborline` service.
 *      Render has no API to create a Blueprint from a repo: if the service does not exist yet, this step stops as
 *      `pending` with the exact clicks (docs/GOLIVE.md step 3), and the next run continues.
 *   2. register the PayPal webhooks for <service URL>/api/webhooks/paypal (sandbox-setup's code) if not done yet.
 *   3. set the web service's env (only keys whose value differs; secrets are never printed) and the scheduler's
 *      RENDER_API_KEY. 4. deploy if anything changed (or nothing is live), wait for `live`.
 *   5. scripts/verify-deploy.sh (with the env group's internal secret for the signed check), then the hosted e2e:
 *      a /demo run through the app's API, recording the real batch id and the verified webhook.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rel, writeOut, type Ctx, type Step, type StepResult } from '../lib/context.js';
import { has, hostedParts, mask, paypalTarget, type Env } from '../lib/env.js';
import { maskReceiver, type HostedEvidence, type SpikeData } from '../lib/evidence.js';
import { hostedE2E } from '../lib/hosted.js';
import { credentials, errorShape, paypalFor } from '../lib/paypal-admin.js';
import { DEPLOY_BAD, DEPLOY_OK, RenderApi, type RenderService } from '../lib/render-api.js';
import { registerWebhooks } from './sandbox-setup.js';

export const WEB_SERVICE = 'neighborline';
export const SCHEDULER = 'neighborline-scheduler';
export const REPO_URL = 'https://github.com/Aaaaarin/neighborline';

/**
 * The sandbox Personal account the hosted /demo pays instead of the scripted Venmo handles and emails
 * (the app's SANDBOX_DEMO_RECEIVER_EMAIL, apps/web/lib/server/engine/sandbox-standin.ts): SANDBOX_DEMO_RECEIVER_EMAIL,
 * else SANDBOX_PERSONAL_EMAIL. Sandbox Venmo payouts don't settle (PayPal documents only a mock), so without it the
 * hosted hero could not reach SUCCESS in sandbox mode.
 */
export function demoReceiver(env: Env): string | null {
  const v = (env.SANDBOX_DEMO_RECEIVER_EMAIL || env.SANDBOX_PERSONAL_EMAIL || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** GOLIVE_HOSTED_PAYPAL_MODE wins; by default sandbox when both PayPal apps' keys and a demo receiver exist, else the labelled fake. */
export function hostedPaypalMode(env: Env): 'fake' | 'sandbox' {
  if (env.GOLIVE_HOSTED_PAYPAL_MODE === 'fake' || env.GOLIVE_HOSTED_PAYPAL_MODE === 'sandbox') return env.GOLIVE_HOSTED_PAYPAL_MODE;
  const paypalKeys = has(env, 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_PAYOUTS_CLIENT_ID', 'PAYPAL_PAYOUTS_CLIENT_SECRET');
  return paypalKeys && demoReceiver(env) ? 'sandbox' : 'fake';
}

/** Pure: the env the hosted web service should have, from local keys and generated ids. `null` = remove the key. */
export function desiredWebEnv(env: Env, url: string): Record<string, string | null> {
  const mode = hostedPaypalMode(env);
  const ai = has(env, 'ANTHROPIC_API_KEY') || has(env, 'OPENAI_API_KEY');
  const out: Record<string, string | null> = { APP_BASE_URL: url, PAYPAL_MODE: mode, AI_MODE: ai ? 'live' : 'fixture' };
  if (ai) out.LLM_PROVIDER = has(env, 'ANTHROPIC_API_KEY') ? 'anthropic' : 'openai';
  const copy = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_PAYOUTS_CLIENT_ID', 'PAYPAL_PAYOUTS_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_PAYOUTS_WEBHOOK_ID', 'PAYPAL_PLAN_ID_10', 'PAYPAL_PLAN_ID_25', 'PAYPAL_PLAN_ID_50', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  for (const k of copy) if (env[k]) out[k] = env[k]!;
  // The browser SDK must talk to the same PayPal as the server: real buttons only in sandbox mode.
  out.NEXT_PUBLIC_PAYPAL_CLIENT_ID = mode === 'sandbox' && env.PAYPAL_CLIENT_ID ? env.PAYPAL_CLIENT_ID : null;
  // /demo payouts settle for real in sandbox: Lan/Jean/Walter → this sandbox account, Rosa → a fresh unregistered address.
  out.SANDBOX_DEMO_RECEIVER_EMAIL = mode === 'sandbox' ? demoReceiver(env) : null;
  return out;
}

export function envDiff(current: Record<string, string>, desired: Record<string, string | null>): Array<{ key: string; action: 'set' | 'remove' }> {
  const out: Array<{ key: string; action: 'set' | 'remove' }> = [];
  for (const [k, v] of Object.entries(desired)) {
    if (v === null) {
      if (k in current) out.push({ key: k, action: 'remove' });
    } else if (current[k] !== v) out.push({ key: k, action: 'set' });
  }
  return out;
}

export const BLUEPRINT_CLICKS = [
  `Open https://dashboard.render.com/blueprints → New Blueprint Instance (or one click: https://render.com/deploy?repo=${REPO_URL})`,
  'Connect GitHub if asked and pick Aaaaarin/neighborline, branch main; name the Blueprint "neighborline"',
  'Leave every prompted value EMPTY (APP_BASE_URL, PayPal, AI keys, RENDER_API_KEY): pnpm golive fills them',
  'Click Apply (Render creates the web service, Postgres, the workflow and the cron job; the first build may fail health checks without keys, which is fine)',
  'Run: pnpm golive --only deploy-render',
];

interface DeployState {
  url?: string;
  serviceId?: string;
  schedulerId?: string;
  lastDeployId?: string;
  lastDeployStatus?: string;
  envKeysSet?: string[];
  verify?: { code: number | null; output: string };
  hosted?: HostedEvidence;
}

export const deployRender: Step = {
  name: 'deploy-render',
  title: 'Render: Blueprint service, env vars, deploy, smoke test, hosted e2e',
  async run(ctx: Ctx): Promise<StepResult> {
    if (!has(ctx.env, 'RENDER_API_KEY')) return { status: 'skipped', summary: 'no RENDER_API_KEY', next: 'Create an API key (dashboard.render.com → Account settings → API keys) and add RENDER_API_KEY to .env.' };
    if (ctx.dryRun) {
      ctx.log(`  would validate render.yaml, find service "${WEB_SERVICE}", set ${Object.keys(desiredWebEnv(ctx.env, 'https://<service>.onrender.com')).length} env keys, deploy, run scripts/verify-deploy.sh and a hosted /demo run`);
      return { status: 'ok', summary: 'dry run' };
    }
    const api = new RenderApi(ctx.env.RENDER_API_KEY!, { ...(ctx.env.RENDER_API_URL ? { baseUrl: ctx.env.RENDER_API_URL } : {}), fetch: ctx.fetch, sleep: ctx.sleep });
    const st = ctx.state.get<DeployState>('deploy-render');
    const save = (patch: Partial<DeployState>) => ctx.state.patch('deploy-render', patch as Record<string, unknown>);

    // 1. Owner, Blueprint validation, the service.
    const owners = await api.owners();
    const owner = owners.find((o) => o.id === ctx.env.RENDER_OWNER_ID) ?? owners[0];
    if (!owner) return { status: 'failed', summary: 'the Render API key sees no workspace', next: 'Check RENDER_API_KEY belongs to the account that will host Neighborline.' };
    try {
      const v = await api.validateBlueprint(owner.id, readFileSync(join(ctx.repo, 'render.yaml'), 'utf8'));
      ctx.log(`  render.yaml: ${v.valid ? 'valid' : `INVALID ${JSON.stringify(v.errors).slice(0, 300)}`}`);
      if (!v.valid) return { status: 'failed', summary: 'Render says render.yaml is invalid', next: `Fix render.yaml (python3 scripts/validate-render-yaml.py): ${JSON.stringify(v.errors).slice(0, 400)}` };
    } catch (err) {
      ctx.log(`  render.yaml validation unavailable (${(err as Error).message.slice(0, 120)}); continuing`);
    }
    const [web] = await api.servicesByName(WEB_SERVICE);
    if (!web) {
      const bps = await api.blueprints().catch(() => []);
      return {
        status: 'pending',
        summary: bps.length ? `Blueprint "${bps[0]!.name}" (${bps[0]!.status ?? '?'}) exists but no "${WEB_SERVICE}" service yet` : 'the Blueprint has not been applied yet (Render has no API for that)',
        next: BLUEPRINT_CLICKS.map((c, i) => `${i + 1}. ${c}`).join(' '),
      };
    }
    const url = (web.serviceDetails?.url ?? `https://${web.name}.onrender.com`).replace(/\/+$/, '');
    ctx.setGenerated('HOSTED_URL', hostedParts(url)!.host);
    save({ url, serviceId: web.id });
    ctx.log(`  service ${web.id} → ${url}${web.suspended && web.suspended !== 'not_suspended' ? ` (suspended: ${web.suspended})` : ''}`);

    // 2. PayPal webhooks for this URL.
    const setup = ctx.state.get<{ webhooks?: { url?: string } }>('sandbox-setup');
    if ((credentials(ctx.env, 'main') || credentials(ctx.env, 'payouts')) && setup.webhooks?.url !== `${url}/api/webhooks/paypal`) {
      try {
        await registerWebhooks(ctx, url);
      } catch (err) {
        return { status: 'failed', summary: `webhook registration failed: ${(err as Error).message}`, next: 'Fix the PayPal problem above, then pnpm golive --only deploy-render.' };
      }
    }

    // 3. Env vars (only what differs), web + scheduler.
    const desired = desiredWebEnv(ctx.env, url);
    const current = await api.envVars(web.id);
    const diff = envDiff(current, desired);
    for (const d of diff) {
      if (d.action === 'set') await api.putEnvVar(web.id, d.key, desired[d.key]!);
      else await api.deleteEnvVar(web.id, d.key);
      ctx.log(`  env ${d.action} ${d.key}${d.action === 'set' ? ` = ${/SECRET|KEY/.test(d.key) ? mask(desired[d.key]!) : /EMAIL/.test(d.key) ? maskReceiver(desired[d.key]!) : desired[d.key]}` : ''}`);
    }
    const [sched] = await api.servicesByName(SCHEDULER).catch(() => [] as RenderService[]);
    let schedChanged = false;
    if (sched) {
      const cur = await api.envVars(sched.id);
      if (cur.RENDER_API_KEY !== ctx.env.RENDER_API_KEY) {
        await api.putEnvVar(sched.id, 'RENDER_API_KEY', ctx.env.RENDER_API_KEY!);
        schedChanged = true;
        ctx.log(`  env set RENDER_API_KEY on ${SCHEDULER}`);
      }
    }
    save({ envKeysSet: diff.map((d) => d.key), ...(sched ? { schedulerId: sched.id } : {}) });

    // 4. Deploy when something changed or nothing is live; wait for it.
    const recent = await api.deploys(web.id, 3);
    const latest = recent[0];
    const moving = latest && !DEPLOY_OK.has(latest.status) && !DEPLOY_BAD.has(latest.status);
    let deploy = latest;
    if (diff.length || ctx.force || !latest || DEPLOY_BAD.has(latest.status) || (!moving && !recent.some((x) => DEPLOY_OK.has(x.status)))) {
      deploy = (await api.triggerDeploy(web.id)) ?? undefined;
      ctx.log(`  deploy ${deploy?.id ?? '(queued)'} triggered${diff.length ? ` for ${diff.length} env change(s)` : ''}`);
    } else ctx.log(`  no env change; ${moving ? `waiting for deploy ${latest!.id} (${latest!.status})` : `deploy ${latest!.id} is live`}`);
    if (schedChanged && sched) await api.triggerDeploy(sched.id).catch(() => null);
    if (deploy) {
      const until = Date.now() + Number(ctx.env.GOLIVE_DEPLOY_TIMEOUT_MIN ?? 25) * 60_000;
      let last = '';
      while (!DEPLOY_OK.has(deploy.status) && !DEPLOY_BAD.has(deploy.status) && Date.now() < until) {
        await ctx.sleep(Number(ctx.env.GOLIVE_DEPLOY_POLL_MS ?? 10_000));
        deploy = await api.deploy(web.id, deploy.id);
        if (deploy.status !== last) ctx.log(`    ${deploy.id}: ${deploy.status}`);
        last = deploy.status;
      }
      save({ lastDeployId: deploy.id, lastDeployStatus: deploy.status });
      if (DEPLOY_BAD.has(deploy.status)) return { status: 'failed', summary: `deploy ${deploy.id} ${deploy.status}`, next: `Open ${web.dashboardUrl ?? 'the service in the Render dashboard'} → Events → the failed deploy's logs. Look for "[render-start]" / "config.invalid" (docs/DEPLOY.md Troubleshooting). Fix, then pnpm golive --only deploy-render.` };
      if (!DEPLOY_OK.has(deploy.status)) return { status: 'pending', summary: `deploy ${deploy.id} still ${deploy.status}`, next: 'Render is slow today: re-run pnpm golive --only deploy-render in a few minutes (it waits for the same deploy).' };
    }

    // 5. Smoke test + hosted e2e.
    const internal = await api.envGroupVars('neighborline-internal').catch(() => null);
    const v = await ctx.run('bash', [join(ctx.repo, 'scripts/verify-deploy.sh'), url], { cwd: ctx.repo, env: { ...process.env, NEIGHBORLINE_INTERNAL_SECRET: internal?.NEIGHBORLINE_INTERNAL_SECRET ?? '' }, timeoutMs: 600_000, logFile: join(ctx.out, 'deploy', 'verify-deploy.log') });
    save({ verify: { code: v.code, output: v.stdout.slice(-4000) } });
    ctx.log(v.stdout.trim().split('\n').map((l) => `  ${l}`).join('\n'));
    if (v.code !== 0) return { status: 'failed', summary: `scripts/verify-deploy.sh ${url} failed`, next: `See golive-out/deploy/verify-deploy.log. Fallback: set GOLIVE_HOSTED_PAYPAL_MODE=fake and re-run (docs/GOLIVE.md "Fallbacks").`, outputs: [rel(ctx, join(ctx.out, 'deploy', 'verify-deploy.log'))] };

    const hosted = await hostedE2E(ctx.fetch, url, { scenario: ctx.env.GOLIVE_HERO_SCENARIO ?? 'lan', timeoutMs: Number(ctx.env.GOLIVE_HOSTED_TIMEOUT_SECONDS ?? 240) * 1000 });
    if (hosted.webhookVerified && hosted.paypalMode === 'sandbox' && credentials(ctx.env, 'payouts')) {
      try {
        const pp = paypalFor(ctx.env, 'payouts', ctx.fetch);
        const ev = await pp.client.request<{ event_type: string; create_time?: string }>({ path: `/v1/notifications/webhooks-events/${encodeURIComponent(hosted.webhookVerified.eventId)}` });
        hosted.confirmedAtPayPal = { eventType: ev.data.event_type, ...(ev.data.create_time ? { createTime: ev.data.create_time } : {}) };
      } catch (err) {
        hosted.confirmedAtPayPal = { error: errorShape(err).name };
      }
    }
    const receiver = desired.PAYPAL_MODE === 'sandbox' ? desired.SANDBOX_DEMO_RECEIVER_EMAIL : null;
    if (receiver && hosted.paypalMode === 'sandbox') hosted.standIn = maskReceiver(receiver);
    const { events: _events, ...hostedEvidence } = hosted;
    save({ hosted: hostedEvidence });
    // The spike's evidence report gets the hosted result too.
    const spike = ctx.state.get<SpikeData>('sandbox-spike');
    if (spike.runId) ctx.state.patch('sandbox-spike', { hosted: hostedEvidence });
    const file = writeOut(ctx, 'deploy/hosted-e2e.json', hosted);
    ctx.log(`  hosted ${hosted.scenario}: PAYPAL_MODE=${hosted.paypalMode} batch ${hosted.paypalBatchId ?? '-'} item ${hosted.itemStatus ?? '-'}${hosted.standIn ? ` (stand-in ${hosted.standIn})` : ''} webhook ${hosted.webhookVerified?.eventId ?? '-'} (${hosted.seconds} s)`);
    const target = (() => {
      try {
        return paypalTarget(ctx.env);
      } catch {
        return 'fake';
      }
    })();
    const summary = `${url} live; verify-deploy ok; /demo ${hosted.scenario}: ${hosted.itemStatus ?? hosted.error ?? '?'}${hosted.webhookVerified ? ', webhook verified' : ''}`;
    if (hosted.error || !hosted.itemStatus) return { status: 'warn', summary, next: `Hosted /demo run: ${hosted.error ?? 'no payout status'}. See docs/GOLIVE.md "Fallbacks" (check SANDBOX_DEMO_RECEIVER_EMAIL / SANDBOX_PERSONAL_EMAIL is a sandbox Personal account, or GOLIVE_HOSTED_PAYPAL_MODE=fake).`, outputs: [rel(ctx, file)] };
    if (hosted.paypalMode === 'sandbox' && hosted.itemStatus !== 'SUCCESS' && hosted.scenario !== 'rosa') return { status: 'warn', summary, next: `The hosted ${hosted.scenario} payout ended ${hosted.itemStatus}, not SUCCESS: check the stand-in ${hosted.standIn ?? '(none: set SANDBOX_DEMO_RECEIVER_EMAIL)'} is a sandbox PERSONAL account, or use GOLIVE_HOSTED_PAYPAL_MODE=fake (docs/GOLIVE.md "Fallbacks").`, outputs: [rel(ctx, file)] };
    if (hosted.paypalMode === 'sandbox' && target === 'sandbox' && !hosted.webhookVerified) return { status: 'warn', summary, next: 'No verified payout webhook reached the app within the wait: check the Payouts app\'s webhook delivery log at developer.paypal.com and PAYPAL_PAYOUTS_WEBHOOK_ID on Render.', outputs: [rel(ctx, file)] };
    return { status: 'ok', summary, outputs: [rel(ctx, file)] };
  },
};
