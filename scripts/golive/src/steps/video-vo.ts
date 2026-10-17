/**
 * video-vo: the demo video with the OpenAI voiceover (`node docs/submission/video/build.mjs --with-vo`), with the
 * hosted URL on the end card when deploy-render has one. Copies the MP4, captions and thumbnail to golive-out/video/.
 * About 10-15 minutes when the takes are cached.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { rel, type Ctx, type Step, type StepResult } from '../lib/context.js';
import { has, hostedParts } from '../lib/env.js';

export function finalVideoFrom(output: string): string | null {
  const all = [...output.matchAll(/done: (\S+\.mp4)/g)];
  return all.at(-1)?.[1] ?? null;
}

export const videoVo: Step = {
  name: 'video-vo',
  title: 'Video: voiceover build (gpt-4o-mini-tts) and the hosted URL on the end card',
  async run(ctx: Ctx): Promise<StepResult> {
    if (!has(ctx.env, 'OPENAI_API_KEY')) return { status: 'skipped', summary: 'no OPENAI_API_KEY', next: 'Add OPENAI_API_KEY to .env.' };
    const host = hostedParts(ctx.env.HOSTED_URL)?.host;
    const videoOut = ctx.env.VIDEO_OUT ?? '/home/claude/video-out';
    const args = [join(ctx.repo, 'docs/submission/video/build.mjs'), '--with-vo'];
    if (ctx.dryRun) {
      ctx.log(`  would run: HOSTED_URL=${host ?? '(unset: end card says "Live demo link in the description")'} VIDEO_OUT=${videoOut} node ${args.map((a) => rel(ctx, a)).join(' ')}`);
      return { status: 'ok', summary: 'dry run' };
    }
    if ((await ctx.run('ffmpeg', ['-version'], { timeoutMs: 10_000 })).code !== 0) return { status: 'failed', summary: 'ffmpeg is not installed', next: 'Install ffmpeg (apt-get install ffmpeg / brew install ffmpeg), or skip: pnpm golive --skip video-vo' };
    const done = ctx.state.get<{ host?: string; file?: string }>('video-vo');
    if (!ctx.force && done.file && existsSync(done.file) && done.host === (host ?? '')) return { status: 'ok', summary: `already built for ${host ?? 'no hosted URL'}: ${done.file}` };
    const log = join(ctx.out, 'video', 'build.log');
    ctx.log(`  building the voiceover cut (about 10-15 min; log: ${rel(ctx, log)})`);
    const r = await ctx.run('node', args, { cwd: ctx.repo, env: { ...process.env, ...ctx.env, VIDEO_OUT: videoOut, ...(host ? { HOSTED_URL: host } : {}) }, timeoutMs: 60 * 60_000, logFile: log });
    const final = finalVideoFrom(r.stdout + r.stderr);
    if (r.code !== 0 || !final) return { status: 'failed', summary: `video build failed (exit ${r.code}${r.timedOut ? ', timed out' : ''})`, next: `Read ${rel(ctx, log)}. A missing takes/mcp-demo.mp4 needs: pnpm --filter @neighborline/example-mcp-agent-demo record. Or skip: pnpm golive --skip video-vo`, outputs: [rel(ctx, log)] };
    const dest = join(ctx.out, 'video');
    mkdirSync(dest, { recursive: true });
    const outputs = [rel(ctx, log)];
    for (const f of [final, join(videoOut, 'captions.srt'), join(videoOut, 'thumbnail.png'), join(videoOut, 'edl.json')]) {
      if (!existsSync(f)) continue;
      copyFileSync(f, join(dest, basename(f)));
      outputs.push(rel(ctx, join(dest, basename(f))));
    }
    const warnings = (r.stdout + r.stderr).split('\n').filter((l) => /WARNING|VO fit/.test(l));
    for (const w of warnings) ctx.log(`  ${w.trim()}`);
    ctx.state.patch('video-vo', { host: host ?? '', file: join(dest, basename(final)) });
    return {
      status: warnings.length ? 'warn' : 'ok',
      summary: `${basename(final)}${host ? ` with ${host}/demo on the end card` : ' (no hosted URL on the end card yet)'}`,
      ...(warnings.length ? { next: `VO timing warnings: ${warnings.slice(0, 3).join(' | ')} (docs/submission/video/README.md "Where the voiceover goes")` } : !host ? { next: 'Re-run after deploy-render so the end card shows the hosted URL: pnpm golive --only video-vo --force' } : {}),
      outputs,
    };
  },
};
