/**
 * live-ai and video-vo with a recording command runner (no OpenAI calls) and a mock app for the three intakes,
 * including the live-AI human check (proof of work bound to the visitor cookie).
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO } from './lib/context.js';
import { solvePow } from './lib/human.js';
import { runGolive } from './lib/orchestrate.js';
import { liveAi, parseEvalOutput } from './steps/live-ai.js';
import { finalVideoFrom, videoVo } from './steps/video-vo.js';
import { fakeRunner, tmp } from './test-helpers.js';

/** What a perfect live model would extract: the scenario fixtures' own labels. */
const EXPECT: Record<string, { lang: string; payout: string; category: string; household: number }> = Object.fromEntries(
  ['lan_vi', 'rosa_es', 'jean_ht'].map((id) => {
    const sc = JSON.parse(readFileSync(join(REPO, 'packages/agents/fixtures/scenarios', `${id}.json`), 'utf8'));
    return [`${id}.mp3`, { lang: sc.lang, payout: sc.extraction.payout?.value, category: sc.extraction.category, household: sc.extraction.householdSize }];
  }),
);

let app: { url: string; server: Server; audioCalls: number; refused: number };

beforeAll(async () => {
  const state = { audioCalls: 0, refused: 0, challenge: 'ch-1' };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const cookie = String(req.headers.cookie ?? '');
    const json = (status: number, b: unknown, h: Record<string, string> = {}) => res.writeHead(status, { 'content-type': 'application/json', ...h }).end(JSON.stringify(b));
    const p = req.url ?? '';
    if (p === '/api/intake/start') return json(200, { requestId: 'req_v_t1_1' }, { 'set-cookie': 'nl_visitor=t1; Path=/' });
    if (p === '/api/human/challenge') return cookie.includes('nl_visitor=t1') ? json(200, { kind: 'pow', challenge: state.challenge, bits: 8, count: 2 }) : json(400, { error: 'no visitor' });
    if (p === '/api/human/verify') {
      const b = JSON.parse(body.toString()) as { solution: number[] };
      const ok = JSON.stringify(b.solution) === JSON.stringify(solvePow({ challenge: state.challenge, bits: 8, count: 2 }));
      return ok ? json(200, { ok: true }, { 'set-cookie': 'nl_human=pass; Path=/' }) : json(403, { code: 'bad_solution' });
    }
    if (/\/audio$/.test(p)) {
      state.audioCalls++;
      if (!cookie.includes('nl_human=pass') || !cookie.includes('nl_visitor=t1')) return state.refused++, json(403, { code: 'human_check_required' });
      const name = /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1] ?? '';
      const e = EXPECT[name]!;
      return json(200, { requestId: 'req_v_t1_1', status: 'awaiting_confirmation', simulatedTranscript: false, transcript: { text: `heard ${name}`, lang: e.lang, textEn: 'english' }, readBack: { text: 'read back', lang: e.lang, textEn: 'rb' }, extraction: { payout: { value: e.payout }, category: e.category, householdSize: e.household }, missing: [] });
    }
    if (/\/thread$/.test(p)) return json(200, { messages: [] });
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  app = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    server,
    get audioCalls() {
      return state.audioCalls;
    },
    get refused() {
      return state.refused;
    },
  };
});
afterAll(() => app.server.close());

/** A throwaway repo with the scenario fixtures (make-demo-audio "writes" mp3s into it). */
function fakeRepo(): string {
  const repo = tmp('golive-repo-');
  cpSync(join(REPO, 'packages/agents/fixtures/scenarios'), join(repo, 'packages/agents/fixtures/scenarios'), { recursive: true });
  return repo;
}

describe('pow solver', () => {
  it('finds n with the leading zero bits', () => {
    const sol = solvePow({ challenge: 'abc', bits: 10, count: 3 });
    expect(sol).toHaveLength(3);
    sol.forEach((n, i) => expect(createHash('sha256').update(`abc.${i}.${n}`).digest().readUInt32BE(0) >>> 22).toBe(0));
  });
});

describe('live-ai', () => {
  it('runs the eval per provider, makes the audio, passes the human check and runs three intakes', async () => {
    const repo = fakeRepo();
    const out = tmp();
    const { run, calls } = fakeRunner([
      { match: (c, a) => c === 'pnpm' && a.includes('eval'), stdout: 'neighborline eval · mode=live\nMeasured: OpenAILLM\ncases 302 · schema-valid 1st output 99%\nwrote /repo/packages/agents/eval/results/2026-11-10-live-gpt-5.4-mini.json\nupdated docs/EVAL.md\neval thresholds met\n' },
      {
        match: (c, a) => c === 'pnpm' && a.includes('make-demo-audio'),
        effect: () => {
          mkdirSync(join(repo, 'packages/agents/fixtures/audio'), { recursive: true });
          for (const id of ['lan_vi', 'rosa_es', 'jean_ht']) writeFileSync(join(repo, 'packages/agents/fixtures/audio', `${id}.mp3`), Buffer.from(`ID3 ${id}`));
        },
      },
    ]);
    const env = { OPENAI_API_KEY: `sk-${'c'.repeat(30)}`, GOLIVE_INTAKE_BASE_URL: app.url };
    const report = await runGolive({ repo, out, steps: [liveAi], processEnv: env, run, quiet: true });
    const r = report.results.find((x) => x.step === 'live-ai')!.result;
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'ok' });
    expect(calls.map((c) => c.args.join(' '))).toEqual(['--filter @neighborline/agents eval --mode live --provider openai --check', '--filter @neighborline/agents make-demo-audio']);
    expect(calls[0]!.env?.OPENAI_API_KEY).toBe(env.OPENAI_API_KEY);
    const lan = JSON.parse(readFileSync(join(out, 'live-ai/intake-lan_vi.json'), 'utf8'));
    expect(lan).toMatchObject({ ok: true, humanCheck: 'pow', requestId: 'req_v_t1_1' });
    expect(lan.checks.map((c: { name: string }) => c.name)).toEqual(['real speech-to-text (not a fixture)', 'status', 'language detected', 'payout destination', 'category', 'household']);
    expect(app.refused).toBe(0);
    expect(readFileSync(join(out, 'live-ai/INTAKES.md'), 'utf8')).toContain('| lan_vi | vi |');

    // Resumes: a second run redoes nothing.
    const again = await runGolive({ repo, out, steps: [liveAi], processEnv: env, run, quiet: true });
    expect(again.results[0]!.result.status).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('a missed eval threshold is a warning, a crashed eval a failure with a way around it', async () => {
    expect(parseEvalOutput('wrote x.json\neval thresholds FAILED:\n  - a').thresholds).toBe('failed');
    const { run } = fakeRunner([{ match: (_c, a) => a.includes('eval'), code: 1, stderr: 'live eval with --provider openai needs OPENAI_API_KEY' }]);
    const report = await runGolive({ repo: fakeRepo(), out: tmp(), steps: [liveAi], processEnv: { OPENAI_API_KEY: `sk-${'d'.repeat(30)}`, GOLIVE_INTAKE_BASE_URL: app.url }, run, quiet: true });
    expect(report.stoppedAt).toBe('live-ai');
    expect(report.results[0]!.result.next).toContain('--skip live-ai');
  });
});

describe('video-vo', () => {
  it('builds with the hosted URL on the end card and copies the outputs', async () => {
    const out = tmp();
    const videoOut = tmp('video-out-');
    const final = join(videoOut, 'neighborline-draft3-vo.mp4');
    const { run, calls } = fakeRunner([
      { match: (c) => c === 'ffmpeg' },
      {
        match: (c, a) => c === 'node' && a.includes('--with-vo'),
        stdout: `[video] VO fit: ok\n[video] done: ${final} (160.52 s)\n`,
        effect: () => {
          writeFileSync(final, 'mp4');
          writeFileSync(join(videoOut, 'captions.srt'), '1\n');
        },
      },
    ]);
    const report = await runGolive({ repo: REPO, out, steps: [videoVo], processEnv: { OPENAI_API_KEY: `sk-${'e'.repeat(30)}`, HOSTED_URL: 'https://neighborline.onrender.com', VIDEO_OUT: videoOut }, run, quiet: true });
    const r = report.results.find((x) => x.step === 'video-vo')!.result;
    expect(r.summary).toContain('neighborline.onrender.com/demo');
    const build = calls.find((c) => c.cmd === 'node')!;
    expect(build.env?.HOSTED_URL).toBe('neighborline.onrender.com');
    expect(existsSync(join(out, 'video', 'neighborline-draft3-vo.mp4'))).toBe(true);
    expect(existsSync(join(out, 'video', 'captions.srt'))).toBe(true);
    expect(finalVideoFrom('done: /a.mp4 (1 s)\ndone: /b-vo.mp4 (2 s)')).toBe('/b-vo.mp4');
  });
});
