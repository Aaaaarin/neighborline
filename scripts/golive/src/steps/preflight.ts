/**
 * preflight: which keys are present and well-formed, whether each PayPal app authenticates (and what PayPal says
 * it may do), which tools exist, and therefore which steps can run. Writes golive-out/preflight.json.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeOut, type Ctx, type Step, type StepResult } from '../lib/context.js';
import { checkKeys, has, paypalBase, paypalTarget, type Env } from '../lib/env.js';
import { oauthInfo, SCOPES, type OAuthInfo } from '../lib/paypal-admin.js';

export interface Capability {
  step: string;
  can: boolean;
  why: string;
}

export function capabilities(env: Env, tools: { ffmpeg: boolean; playwright: boolean }): Capability[] {
  const main = has(env, 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET');
  const payouts = has(env, 'PAYPAL_PAYOUTS_CLIENT_ID', 'PAYPAL_PAYOUTS_CLIENT_SECRET');
  const openai = has(env, 'OPENAI_API_KEY');
  const anthropic = has(env, 'ANTHROPIC_API_KEY');
  const render = has(env, 'RENDER_API_KEY');
  const buyer = has(env, 'SANDBOX_BUYER_EMAIL', 'SANDBOX_BUYER_PASSWORD');
  const join_ = (xs: Array<string | false>) => xs.filter(Boolean).join('; ');
  return [
    { step: 'sandbox-setup', can: main || payouts, why: main || payouts ? join_([main ? 'main app: catalog, plans, Transaction Search, donation webhooks' : 'no main app keys: plans and Transaction Search skipped', payouts ? 'payouts app: payout webhooks' : 'no payouts app keys']) : 'needs PAYPAL_CLIENT_ID/SECRET and/or PAYPAL_PAYOUTS_CLIENT_ID/SECRET' },
    {
      step: 'sandbox-spike',
      can: payouts,
      why: payouts
        ? join_([
            has(env, 'SANDBOX_PERSONAL_EMAIL') ? 'PayPal-wallet payout to SANDBOX_PERSONAL_EMAIL' : 'no SANDBOX_PERSONAL_EMAIL: the PayPal-wallet item goes to an unregistered address instead',
            main ? (buyer ? (tools.playwright ? 'Orders: create + buyer approval (Playwright) + capture' : 'Orders: create only (Playwright not installed)') : 'Orders: create only (no SANDBOX_BUYER_EMAIL/PASSWORD)') : 'no main app: Orders and Transaction Search skipped',
            has(env, 'GOLIVE_WEBHOOK_CAPTURE_URL') ? 'webhook capture via GOLIVE_WEBHOOK_CAPTURE_URL' : 'webhook signature check of a real delivery happens after deploy (hosted e2e)',
          ])
        : 'needs PAYPAL_PAYOUTS_CLIENT_ID/SECRET (the Payouts app)',
    },
    { step: 'live-ai', can: openai || anthropic, why: openai ? join_(['eval (OpenAI)', anthropic && 'eval (Claude)', 'demo audio (TTS)', '3 live intakes']) : anthropic ? 'eval (Claude) only: TTS/STT need OPENAI_API_KEY' : 'needs OPENAI_API_KEY' },
    { step: 'deploy-render', can: render, why: render ? 'Render API: find the Blueprint service, set env, deploy, verify' : 'needs RENDER_API_KEY' },
    { step: 'video-vo', can: openai && tools.ffmpeg, why: !openai ? 'needs OPENAI_API_KEY' : tools.ffmpeg ? 'gpt-4o-mini-tts narration + mix' : 'needs ffmpeg on PATH' },
    { step: 'finalize-docs', can: true, why: 'fills whatever is known (hosted URL, video id, sandbox evidence) and checks links' },
  ];
}

function scopeNotes(app: 'main' | 'payouts', info: OAuthInfo): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!info.ok) return { errors: [`${app} app: OAuth failed (${info.error}). Wrong environment (live keys?) or a typo.`], warnings };
  const s = new Set(info.scopes);
  if (app === 'payouts' && !s.has(SCOPES.payouts)) errors.push('payouts app: PayPal did not grant the Payouts scope. developer.paypal.com → the app → Features → tick Payouts → Save.');
  if (app === 'main' && s.has(SCOPES.payouts)) warnings.push('main app can also send payouts. For least privilege untick Payouts on it (only the approver\'s app should move money).');
  if (app === 'main' && !s.has(SCOPES.reporting)) warnings.push('main app has no Transaction Search scope yet: tick "Transaction search" under the app\'s features (reconcile needs it).');
  return { errors, warnings };
}

export const preflight: Step = {
  name: 'preflight',
  title: 'Preflight: keys, PayPal OAuth, tools',
  async run(ctx: Ctx): Promise<StepResult> {
    const keys = checkKeys(ctx.env);
    let target: 'sandbox' | 'fake';
    try {
      target = paypalTarget(ctx.env);
    } catch (err) {
      return { status: 'failed', summary: (err as Error).message, next: 'Unset PAYPAL_BASE_URL (sandbox is the default) and re-run.' };
    }
    const tools = {
      ffmpeg: (await ctx.run('ffmpeg', ['-version'], { timeoutMs: 10_000 })).code === 0,
      playwright: existsSync(join(ctx.repo, 'apps/web/node_modules/playwright')) || existsSync(join(ctx.repo, 'apps/web/node_modules/@playwright/test')),
    };
    const errors = keys.filter((k) => k.error).map((k) => `${k.key}: ${k.error}`);
    const warnings = keys.filter((k) => k.warning).map((k) => `${k.key}: ${k.warning}`);
    const oauth: Partial<Record<'main' | 'payouts', OAuthInfo>> = {};
    if (!ctx.dryRun) {
      for (const app of ['main', 'payouts'] as const) {
        const present = app === 'main' ? has(ctx.env, 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET') : has(ctx.env, 'PAYPAL_PAYOUTS_CLIENT_ID', 'PAYPAL_PAYOUTS_CLIENT_SECRET');
        if (!present) continue;
        const info = await oauthInfo(ctx.env, app, ctx.fetch);
        oauth[app] = info;
        const n = scopeNotes(app, info);
        errors.push(...n.errors);
        warnings.push(...n.warnings);
      }
      if (oauth.main?.ok && oauth.payouts?.ok && oauth.main.appId && oauth.main.appId === oauth.payouts.appId) {
        warnings.push('PAYPAL_CLIENT_ID and PAYPAL_PAYOUTS_CLIENT_ID are the same app. Create a second app for Payouts (docs/GOLIVE.md step 1).');
      }
    }
    const caps = capabilities(ctx.env, tools);
    for (const k of keys) ctx.log(`  ${k.present ? (k.error ? '✗' : '✓') : '·'} ${k.key.padEnd(30)} ${k.shown}${k.error ? `  ← ${k.error}` : ''}${k.warning ? `  (warning: ${k.warning})` : ''}`);
    for (const [app, info] of Object.entries(oauth)) ctx.log(`  ${info.ok ? '✓' : '✗'} OAuth ${app} app at ${paypalBase(ctx.env)}: ${info.ok ? `${info.scopes.length} scopes, app ${info.appId ?? '?'} (${info.ms} ms)` : info.error}`);
    ctx.log(`  tools: ffmpeg ${tools.ffmpeg ? 'yes' : 'no'}, playwright ${tools.playwright ? 'yes' : 'no'}; PayPal target: ${target}`);
    for (const c of caps) ctx.log(`  ${c.can ? '→' : '·'} ${c.step.padEnd(14)} ${c.why}`);
    for (const w of warnings) ctx.log(`  ! ${w}`);
    const file = writeOut(ctx, 'preflight.json', {
      at: ctx.now().toISOString(),
      dryRun: ctx.dryRun,
      paypal: { base: paypalBase(ctx.env), target, oauth: Object.fromEntries(Object.entries(oauth).map(([k, v]) => [k, { ok: v.ok, status: v.status, appId: v.appId, scopes: v.scopes, error: v.error }])) },
      keys: keys.map(({ key, present, error, warning }) => ({ key, present, error, warning })),
      tools,
      capabilities: caps,
      warnings,
      errors,
    });
    ctx.state.patch('preflight', { capabilities: caps, target, tools });
    const runnable = caps.filter((c) => c.can).map((c) => c.step);
    if (errors.length) return { status: 'failed', summary: `${errors.length} problem(s): ${errors[0]}`, next: errors.join(' | '), outputs: [file] };
    return { status: warnings.length ? 'warn' : 'ok', summary: `can run: ${runnable.join(', ')}${ctx.dryRun ? ' (dry run: OAuth not pinged)' : ''}`, outputs: [file] };
  },
};
