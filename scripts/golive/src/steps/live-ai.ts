/**
 * live-ai: the AI side with real keys.
 *   1. The intake eval in live mode (`pnpm --filter @neighborline/agents eval --mode live --provider openai|anthropic
 *      --check`): writes eval/results/<date>-live-<model>.json and regenerates docs/EVAL.md's generated block (the
 *      eval does that itself for a full run). A threshold miss is a warning to read, not a reason to stop the release.
 *   2. Demo voice notes with TTS (`make-demo-audio`): packages/agents/fixtures/audio/*.mp3 + manifest.json.
 *   3. Three real intakes (vi, es, ht) through the app's API on a private local stack with AI_MODE=live: real
 *      speech-to-text, real LLM, traces in golive-out/live-ai/.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rel, writeOut, type Ctx, type Step, type StepResult } from '../lib/context.js';
import { has } from '../lib/env.js';
import { runIntake, type IntakeScenario, type IntakeTrace } from '../lib/intake.js';
import { startLiveStack } from '../lib/stack.js';

export const INTAKE_SCENARIOS = ['lan_vi', 'rosa_es', 'jean_ht'] as const;
const AUDIO_DIR = 'packages/agents/fixtures/audio';

export function scenarioFor(repo: string, id: string): IntakeScenario {
  const s = JSON.parse(readFileSync(join(repo, 'packages/agents/fixtures/scenarios', `${id}.json`), 'utf8')) as {
    lang: string;
    expected: { status: string };
    extraction: { payout?: { value?: string } | null; category?: string; householdSize?: number };
  };
  return {
    id,
    lang: s.lang,
    audioPath: join(repo, AUDIO_DIR, `${id}.mp3`),
    expectedStatus: s.expected.status,
    ...(s.extraction.payout?.value ? { expectedPayout: s.extraction.payout.value } : {}),
    ...(s.extraction.category ? { expectedCategory: s.extraction.category } : {}),
    ...(s.extraction.householdSize !== undefined ? { expectedHousehold: s.extraction.householdSize } : {}),
  };
}

/** `measured` lines of the eval's summary + whether the thresholds held. */
export function parseEvalOutput(out: string): { wrote?: string; thresholds: 'met' | 'failed' | 'unknown'; lines: string[] } {
  const wrote = /wrote (\S+\.json)/.exec(out)?.[1];
  return {
    ...(wrote ? { wrote } : {}),
    thresholds: /eval thresholds met/.test(out) ? 'met' : /eval thresholds FAILED/.test(out) ? 'failed' : 'unknown',
    lines: out.split('\n').filter((l) => /^(Measured|cases|intake:|injection|impersonation|payout hallucination|latency)/.test(l.trim())),
  };
}

export function renderIntakes(traces: IntakeTrace[]): string {
  const L = ['# Live intakes (real speech-to-text + LLM through the app API)', '', '| Scenario | Lang | Request | Upload → result | Checks | Result |', '|---|---|---|---|---|---|'];
  for (const t of traces) L.push(`| ${t.scenario} | ${t.lang} | \`${t.requestId ?? '-'}\` | ${(t.ms.audio / 1000).toFixed(1)} s | ${t.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` (want ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)})`}`).join('; ')} | ${t.error ? `error: ${t.error}` : t.ok ? 'ok' : 'check'} |`);
  for (const t of traces) {
    const r = t.result as { transcript?: { text?: string; textEn?: string }; readBack?: { text?: string } } | undefined;
    if (!r) continue;
    L.push('', `## ${t.scenario}`, '', `- Heard: ${r.transcript?.text ?? ''}`, `- English: ${r.transcript?.textEn ?? ''}`, `- Read back: ${r.readBack?.text ?? ''}`);
  }
  return `${L.join('\n')}\n`;
}

export const liveAi: Step = {
  name: 'live-ai',
  title: 'Live AI: eval, demo audio, three real intakes',
  async run(ctx: Ctx): Promise<StepResult> {
    const openai = has(ctx.env, 'OPENAI_API_KEY');
    const anthropic = has(ctx.env, 'ANTHROPIC_API_KEY');
    if (!openai && !anthropic) return { status: 'skipped', summary: 'no OPENAI_API_KEY', next: 'Add OPENAI_API_KEY to .env (docs/GOLIVE.md step 4).' };
    const providers = [...(openai ? ['openai'] : []), ...(anthropic ? ['anthropic'] : [])];
    if (ctx.dryRun) {
      for (const p of providers) ctx.log(`  would run: pnpm --filter @neighborline/agents eval --mode live --provider ${p} --check`);
      if (openai) ctx.log(`  would run: pnpm --filter @neighborline/agents make-demo-audio, then intakes ${INTAKE_SCENARIOS.join(', ')} on a local live stack (:3340)`);
      return { status: 'ok', summary: `dry run (${providers.join(' + ')})` };
    }
    const st = ctx.state.get<{ parts?: Record<string, { status: string; note?: string }> }>('live-ai');
    const parts: Record<string, { status: string; note?: string }> = { ...(st.parts ?? {}) };
    const mark = (k: string, status: string, note?: string) => {
      parts[k] = { status, ...(note ? { note } : {}) };
      ctx.state.patch('live-ai', { parts });
    };
    const todo = (k: string) => ctx.force || !['ok', 'warn'].includes(parts[k]?.status ?? '');
    const env = { ...process.env, ...ctx.env } as Record<string, string | undefined>;
    const outputs: string[] = [];

    // 1. Eval per provider.
    for (const p of providers) {
      const key = `eval-${p}`;
      if (!todo(key)) continue;
      ctx.log(`  eval (${p}): the full dataset, live; this takes a while`);
      const log = join(ctx.out, 'live-ai', `${key}.log`);
      const r = await ctx.run('pnpm', ['--filter', '@neighborline/agents', 'eval', '--mode', 'live', '--provider', p, '--check'], { cwd: ctx.repo, env, timeoutMs: 90 * 60_000, logFile: log });
      const parsed = parseEvalOutput(r.stdout + r.stderr);
      for (const l of parsed.lines) ctx.log(`    ${l}`);
      outputs.push(rel(ctx, log));
      if (parsed.wrote) outputs.push(rel(ctx, parsed.wrote), 'docs/EVAL.md');
      if (!parsed.wrote) mark(key, 'failed', `eval did not finish (exit ${r.code}${r.timedOut ? ', timed out' : ''}); see ${rel(ctx, log)}`);
      else mark(key, parsed.thresholds === 'failed' ? 'warn' : 'ok', parsed.thresholds === 'failed' ? 'live thresholds missed: read the eval log and docs/EVAL.md before the demo' : undefined);
    }

    // 2. Demo audio.
    if (openai && todo('audio')) {
      const log = join(ctx.out, 'live-ai', 'make-demo-audio.log');
      const r = await ctx.run('pnpm', ['--filter', '@neighborline/agents', 'make-demo-audio'], { cwd: ctx.repo, env, timeoutMs: 15 * 60_000, logFile: log });
      const missing = INTAKE_SCENARIOS.filter((id) => !existsSync(join(ctx.repo, AUDIO_DIR, `${id}.mp3`)));
      mark('audio', r.code === 0 && !missing.length ? 'ok' : 'failed', r.code === 0 ? (missing.length ? `missing ${missing.join(', ')}` : undefined) : `exit ${r.code}; see ${rel(ctx, log)}`);
      if (r.code === 0) outputs.push(`${AUDIO_DIR}/manifest.json`);
    }

    // 3. Three real intakes.
    if (openai && todo('intakes') && parts.audio?.status === 'ok') {
      let stack: { url: string; stop(): void } | null = null;
      try {
        const base = ctx.env.GOLIVE_INTAKE_BASE_URL ?? (stack = await startLiveStack(ctx.repo, ctx.out, ctx.env, { log: ctx.log })).url;
        const traces: IntakeTrace[] = [];
        for (const id of INTAKE_SCENARIOS) {
          const t = await runIntake(ctx.fetch, base, scenarioFor(ctx.repo, id));
          traces.push(t);
          outputs.push(rel(ctx, writeOut(ctx, `live-ai/intake-${id}.json`, t)));
          ctx.log(`    ${id}: ${t.error ?? (t.ok ? 'ok' : 'check')} (${(t.ms.total / 1000).toFixed(1)} s) ${t.checks.map((c) => `${c.ok ? '✓' : '✗'}${c.name}`).join(' ')}`);
        }
        outputs.push(rel(ctx, writeOut(ctx, 'live-ai/INTAKES.md', renderIntakes(traces))));
        ctx.state.patch('live-ai', { intakes: { date: ctx.now().toISOString().slice(0, 10), ok: traces.filter((t) => t.ok).length, total: traces.length } });
        const errors = traces.filter((t) => t.error);
        const off = traces.filter((t) => !t.error && !t.ok);
        mark('intakes', errors.length ? 'failed' : off.length ? 'warn' : 'ok', errors.length ? errors.map((t) => `${t.scenario}: ${t.error}`).join('; ') : off.length ? `${off.map((t) => t.scenario).join(', ')} differ from the fixture: read golive-out/live-ai/INTAKES.md` : undefined);
      } catch (err) {
        mark('intakes', 'failed', (err as Error).message);
      } finally {
        stack?.stop();
      }
    }

    const all = Object.entries(parts);
    const failed = all.filter(([, v]) => v.status === 'failed');
    const warned = all.filter(([, v]) => v.status === 'warn');
    const summary = all.map(([k, v]) => `${k} ${v.status}`).join(', ');
    if (failed.length) return { status: 'failed', summary, next: `${failed.map(([k, v]) => `${k}: ${v.note}`).join(' | ')}. Fix and re-run (finished parts are kept), or go on without it: pnpm golive --skip live-ai`, outputs };
    return { status: warned.length ? 'warn' : 'ok', summary, ...(warned.length ? { next: warned.map(([k, v]) => `${k}: ${v.note}`).join(' | ') } : {}), outputs };
  },
};
