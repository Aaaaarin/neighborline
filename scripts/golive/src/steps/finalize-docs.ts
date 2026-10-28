/**
 * finalize-docs: put what the run learned into the docs.
 *   - `{HOSTED_URL}` (host, no https://), `{VIDEO_ID}`, `{SANDBOX_BUYER_EMAIL}`/`{SANDBOX_BUYER_PASSWORD}` (only from
 *     JUDGE_SANDBOX_BUYER_*, a sandbox account meant to be published) across README and docs/submission/*.md;
 *   - README "Try it" + Sandbox reality rows, DEVPOST's (sandbox) sentences, docs/PAYPAL.md and docs/SANDBOX_EVIDENCE.md,
 *     ONLY from a run against PayPal's real sandbox (a fake-PayPal run is never published as evidence);
 *   - then the Markdown link checker, the hosted URL, and whether the video's end card has the hosted URL.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackedMarkdown } from '../check-links.js';
import { writeOut, type Ctx, type Step, type StepResult } from '../lib/context.js';
import { devpostSandboxEdits, paypalDocEdit, readmeEdits, replaceToken, type Facts } from '../lib/docs.js';
import { hostedParts } from '../lib/env.js';
import { evidenceFacts, renderEvidence, type HostedEvidence, type SpikeData } from '../lib/evidence.js';
import { checkLinks } from '../lib/links.js';

export const TOKEN_FILES = ['README.md', 'docs/submission/DEVPOST.md', 'docs/submission/DEVPOST_FIELDS.md', 'docs/submission/GITHUB.md', 'docs/submission/YOUTUBE.md', 'docs/submission/VIDEO_SCRIPT.md'];

export function gatherFacts(ctx: Pick<Ctx, 'env' | 'state'>): Facts & { notes: string[] } {
  const notes: string[] = [];
  const host = hostedParts(ctx.env.HOSTED_URL)?.host;
  const spike = ctx.state.get<SpikeData>('sandbox-spike');
  const deploy = ctx.state.get<{ hosted?: HostedEvidence }>('deploy-render');
  const live = ctx.state.get<{ intakes?: { date: string; ok: number; total: number }; parts?: Record<string, { status: string }> }>('live-ai');
  const f: Facts & { notes: string[] } = { notes };
  if (host) f.host = host;
  else notes.push('no HOSTED_URL yet (deploy-render sets it)');
  if (ctx.env.VIDEO_ID) f.videoId = ctx.env.VIDEO_ID;
  else notes.push('no VIDEO_ID yet (after the YouTube upload)');
  if (ctx.env.JUDGE_SANDBOX_BUYER_EMAIL && ctx.env.JUDGE_SANDBOX_BUYER_PASSWORD) f.judgeBuyer = { email: ctx.env.JUDGE_SANDBOX_BUYER_EMAIL, password: ctx.env.JUDGE_SANDBOX_BUYER_PASSWORD };
  else notes.push('no JUDGE_SANDBOX_BUYER_EMAIL/PASSWORD (a sandbox buyer judges may use on /donate)');
  if (spike.runId && spike.target === 'sandbox' && spike.batches?.[0]?.batchId) {
    const e = evidenceFacts(spike);
    f.sandbox = { date: e.date, paypalSuccess: e.paypalSuccess, venmoStatuses: e.venmoStatuses, venmoRefused: e.venmoRefused, venmoMockAccepted: e.venmoMockAccepted, unclaimed: e.unclaimed, duplicateOk: e.duplicateOk, reconciled: e.reconciled, ...(e.batchId ? { batchId: e.batchId } : {}), ...(e.verifiedEventId ? { verifiedEventId: e.verifiedEventId } : {}), ...(e.captureId ? { captureId: e.captureId } : {}) };
  } else if (spike.runId && spike.target !== 'sandbox') notes.push('the sandbox spike ran against a fake PayPal: nothing published as sandbox evidence');
  else notes.push('no sandbox spike yet');
  if (deploy.hosted) f.hosted = deploy.hosted;
  if (live.intakes?.total) f.liveAi = { date: live.intakes.date, intakesOk: live.intakes.ok, intakes: live.intakes.total, evalProviders: Object.keys(live.parts ?? {}).filter((k) => k.startsWith('eval-')).map((k) => k.slice(5)) };
  return f;
}

export const finalizeDocs: Step = {
  name: 'finalize-docs',
  title: 'Docs: hosted URL, video id, sandbox evidence, link check',
  async run(ctx: Ctx): Promise<StepResult> {
    const f = gatherFacts(ctx);
    const changed = new Map<string, string>();
    const read = (file: string) => changed.get(file) ?? readFileSync(join(ctx.repo, file), 'utf8');
    const report: Array<{ file: string; rule: string; applied: boolean; count?: number }> = [];

    // Tokens.
    const tokens: Array<[string, string | undefined]> = [['HOSTED_URL', f.host], ['VIDEO_ID', f.videoId], ['SANDBOX_BUYER_EMAIL', f.judgeBuyer?.email], ['SANDBOX_BUYER_PASSWORD', f.judgeBuyer?.password]];
    for (const file of TOKEN_FILES) {
      if (!existsSync(join(ctx.repo, file))) continue;
      let text = read(file);
      for (const [token, value] of tokens) {
        if (!value) continue;
        const r = replaceToken(text, token, value);
        if (r.count) report.push({ file, rule: `{${token}}`, applied: true, count: r.count });
        text = r.text;
      }
      changed.set(file, text);
    }

    // README rows + DEVPOST sentences + PAYPAL.md + the evidence file (real sandbox only).
    const rd = readmeEdits(read('README.md'), f);
    changed.set('README.md', rd.text);
    for (const e of rd.edits) report.push({ file: 'README.md', ...e });
    if (f.sandbox) {
      for (const name of ['DEVPOST.md', 'DEVPOST_FIELDS.md'] as const) {
        const file = `docs/submission/${name}`;
        const r = devpostSandboxEdits(name, read(file), f.sandbox, f.hosted);
        changed.set(file, r.text);
        report.push({ file, rule: '(sandbox) sentence', applied: r.applied });
      }
      const p = paypalDocEdit(read('docs/PAYPAL.md'), f.sandbox.date);
      changed.set('docs/PAYPAL.md', p.text);
      report.push({ file: 'docs/PAYPAL.md', rule: 'To verify → evidence', applied: p.applied });
      const spike = ctx.state.get<SpikeData>('sandbox-spike');
      changed.set('docs/SANDBOX_EVIDENCE.md', renderEvidence(spike));
      report.push({ file: 'docs/SANDBOX_EVIDENCE.md', rule: 'evidence from golive-out', applied: true });
    }

    const writes = [...changed.entries()].filter(([file, text]) => !existsSync(join(ctx.repo, file)) || readFileSync(join(ctx.repo, file), 'utf8') !== text);
    for (const r of report) ctx.log(`  ${r.applied ? '✓' : '✗'} ${r.file}: ${r.rule}${r.count ? ` ×${r.count}` : ''}${r.applied ? '' : ' (not found: edit by hand)'}`);
    for (const n of f.notes) ctx.log(`  · ${n}`);
    if (ctx.dryRun) {
      ctx.log(`  would write ${writes.length} file(s): ${writes.map(([w]) => w).join(', ') || 'none'}`);
      return { status: 'ok', summary: `dry run: ${writes.length} file(s) would change` };
    }
    for (const [file, text] of writes) writeFileSync(join(ctx.repo, file), text);
    const evidenceCopy = join(ctx.out, 'SANDBOX_EVIDENCE.md');
    if (f.sandbox && existsSync(evidenceCopy)) copyFileSync(join(ctx.repo, 'docs/SANDBOX_EVIDENCE.md'), evidenceCopy);

    // Checks: links, the hosted URL, leftover tokens, the video end card.
    const broken = checkLinks(ctx.repo, [...new Set([...trackedMarkdown(ctx.repo), ...writes.map(([w]) => w)])]);
    for (const b of broken) ctx.log(`  ✗ link ${b.file}:${b.line} ${b.target} (${b.reason})`);
    let hostedOk: boolean | null = null;
    if (f.host) {
      try {
        const res = await ctx.fetch(`https://${f.host}/demo`, { signal: AbortSignal.timeout(60_000) });
        hostedOk = res.ok;
        ctx.log(`  ${res.ok ? '✓' : '✗'} https://${f.host}/demo → ${res.status}`);
      } catch (err) {
        hostedOk = false;
        ctx.log(`  ✗ https://${f.host}/demo: ${(err as Error).message}`);
      }
    }
    const left = TOKEN_FILES.filter((file) => existsSync(join(ctx.repo, file))).flatMap((file) =>
      readFileSync(join(ctx.repo, file), 'utf8')
        .split('\n')
        .flatMap((line, i) => (/grep -rn/.test(line) ? [] : [...line.matchAll(/(`?)\{(HOSTED_URL|VIDEO_ID|SANDBOX_BUYER_EMAIL|SANDBOX_BUYER_PASSWORD)\}(`?)/g)].filter((m) => !(m[1] && m[3])).map((m) => `${file}:${i + 1} {${m[2]}}`))),
    );
    const video = ctx.state.get<{ host?: string }>('video-vo');
    const videoStale = Boolean(f.host && video.host !== undefined && video.host !== f.host);
    writeOut(ctx, 'finalize-docs.json', { facts: { ...f, judgeBuyer: f.judgeBuyer ? { email: f.judgeBuyer.email, password: '(set)' } : undefined }, report, written: writes.map(([w]) => w), broken, hostedOk, left });
    const notApplied = report.filter((r) => !r.applied);
    const summary = `${writes.length} file(s) updated; ${broken.length} broken link(s); ${left.length} placeholder(s) left${hostedOk === null ? '' : `; hosted ${hostedOk ? 'up' : 'DOWN'}`}`;
    const outputs = writes.map(([w]) => w);
    if (broken.length || hostedOk === false) return { status: 'failed', summary, next: [broken.length ? `fix ${broken.length} broken link(s) listed in golive-out/golive.log` : '', hostedOk === false ? `https://${f.host}/demo does not answer 200: check the Render service (docs/DEPLOY.md Troubleshooting)` : ''].filter(Boolean).join(' | '), outputs };
    const nexts = [
      ...(left.length ? [`placeholders left (${[...new Set(left.map((l) => l.split(' ')[1]))].join(', ')}): set ${f.videoId ? '' : 'VIDEO_ID '}${f.host ? '' : 'HOSTED_URL '}${f.judgeBuyer ? '' : 'JUDGE_SANDBOX_BUYER_EMAIL/PASSWORD '}then pnpm golive --only finalize-docs`] : []),
      ...(notApplied.length ? [`edit by hand (wording moved): ${notApplied.map((r) => `${r.file} ${r.rule}`).join('; ')}`] : []),
      ...(videoStale ? ['the video end card predates the hosted URL: pnpm golive --only video-vo --force'] : []),
      ...(writes.length ? ['review and commit: git diff README.md docs/ packages/paypal/PAYPAL_NOTES.md'] : []),
    ];
    return { status: left.length || notApplied.length || videoStale ? 'pending' : 'ok', summary, ...(nexts.length ? { next: nexts.join(' | ') } : {}), outputs };
  },
};
