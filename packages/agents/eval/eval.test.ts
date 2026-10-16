import { describe, expect, it } from 'vitest';
import { canonicalDestination, isGroundedDestination } from '../src/intake/spoken-handles.js';
import { extractNumbers } from '../src/numbers.js';
import { createFixtureLLM } from '../src/fixtures/responders.js';
import { caseIssues, EVAL_LANGS, EVAL_SETS, loadDataset, type EvalCase } from './dataset.js';
import { percentile, rate } from './metrics.js';
import { buildEvalLLM } from './providers.js';
import { BEGIN, END, renderGenerated, spliceGenerated } from './report.js';
import { evalPolicy, runCase } from './run-case.js';
import { parseArgs, runEval, type CliOptions } from './run.js';
import { checkThresholds, loadThresholds } from './thresholds.js';

const { cases, heldOut } = loadDataset();
const byId = (id: string): EvalCase => {
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};
const homoglyph = (c: EvalCase) => c.tags.includes('homoglyph');
const opts = (o: Partial<CliOptions> = {}): CliOptions => ({ ...parseArgs([]), write: false, ...o });

describe('dataset', () => {
  it('has the promised size and coverage', () => {
    const intake = cases.filter((c) => c.set === 'intake');
    expect(intake.length).toBeGreaterThanOrEqual(120);
    for (const lang of EVAL_LANGS) expect(intake.filter((c) => c.lang === lang).length, lang).toBeGreaterThanOrEqual(10);
    const adversarial = cases.filter((c) => c.set === 'adversarial');
    expect(adversarial.length).toBeGreaterThanOrEqual(40);
    expect(new Set(adversarial.map((c) => c.lang)).size).toBe(EVAL_LANGS.length);
    expect(adversarial.filter((c) => c.expect.injection).length).toBeGreaterThanOrEqual(20);
    expect(adversarial.filter((c) => c.expect.impersonation).length).toBeGreaterThanOrEqual(20);
    const benign = cases.filter((c) => c.set === 'benign');
    expect(benign.length).toBeGreaterThanOrEqual(30);
    expect(new Set(benign.map((c) => c.lang)).size).toBe(EVAL_LANGS.length);
    // Every policy category, an ambiguous request and a missing destination in every language.
    for (const lang of EVAL_LANGS) {
      const xs = intake.filter((c) => c.lang === lang);
      expect(new Set(xs.map((c) => c.gold.category)), lang).toEqual(new Set(evalPolicy().categories.map((k) => k.key)));
      expect(xs.some((c) => c.gold.missing.includes('category')), lang).toBe(true);
      expect(xs.filter((c) => c.gold.payout === null).length, lang).toBeGreaterThanOrEqual(2);
    }
  });

  // Independent of the agents' grounding code on purpose: these check the labels, not the system.
  const SPOKEN = /\b(at|dot|dash|underscore|arroba|punto|guion|bajo|a cong|cham|gach|ngang|duoi|arobaz|pwen|tire|anba|arobase|point|tiret|bas|艾特|横杠|골뱅이|하이픈|собака|точка|дефис)\b/giu;
  const WORD_DIGITS: Record<string, string> = { cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9' };
  const wordDigits = (s: string) => s.replace(/\b(cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, (w) => WORD_DIGITS[w] ?? w);
  const alnum = (s: string) => wordDigits(s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(SPOKEN, ' ')).replace(/[^a-z0-9]/g, '');
  const digits = (s: string) => wordDigits(s.toLowerCase()).replace(/\D/g, '');

  it('every labeled destination is canonical and is said in the text', () => {
    for (const c of cases.filter((x) => x.gold.payout && !homoglyph(x))) {
      const p = c.gold.payout!;
      expect(canonicalDestination(p.wallet, p.value, p.type), c.id).toEqual(p);
      if (p.type === 'PHONE') expect(digits(c.text), c.id).toContain(digits(p.value).replace(/^1(?=\d{10}$)/, ''));
      else expect(alnum(c.text.replace(/собака|точка|дефис|艾特|横杠|골뱅이|하이픈/gu, ' ')), c.id).toContain(alnum(p.value));
    }
  });

  it('every labeled amount is a number the person says', () => {
    for (const c of cases.filter((x) => x.gold.requestedAmountCents !== undefined)) {
      const dollars = String((c.gold.requestedAmountCents as number) / 100);
      expect(c.text.replace(/(\d),(\d{3})/g, '$1$2'), c.id).toMatch(new RegExp(`(?<!\\d)${dollars}(?!\\d)`));
    }
  });

  /**
   * Known gaps in the agents' grounding code, found by this dataset (docs/EVAL.md, Findings). A
   * correct model answer for these cases is dropped as "not said". When a gap is fixed, delete its
   * id here: the list must only ever shrink.
   */
  it('known grounding gaps (must only shrink)', () => {
    const destGaps = cases.filter((c) => c.gold.payout && !homoglyph(c) && !isGroundedDestination(c.gold.payout.value, c.text)).map((c) => c.id);
    const amountGaps = cases
      .filter((c) => c.gold.requestedAmountCents !== undefined && !extractNumbers(c.text).some((n) => n.value === (c.gold.requestedAmountCents as number) / 100))
      .map((c) => c.id);
    // Phone numbers said without a country code and without a Latin "Venmo"/"PayPal" keyword nearby; French "point".
    expect(destGaps.sort()).toEqual(['ar-05', 'en-04', 'fr-02', 'fr-05', 'ko-09', 'tl-05']);
    // Digits written against Chinese characters ("要60美元"): numbers.ts ignores digits that follow a letter.
    expect(amountGaps.sort()).toEqual(['ben-25-zh', 'zh-03', 'zh-04', 'zh-11']);
  });

  it('holds out about 20% of every file (frozen in dataset/heldout.txt)', () => {
    const files = [...EVAL_LANGS.map((l) => cases.filter((c) => c.set === 'intake' && c.lang === l)), ...EVAL_SETS.filter((s) => s !== 'intake').map((s) => cases.filter((c) => c.set === s))];
    for (const xs of files) {
      const share = xs.filter((c) => heldOut.has(c.id)).length / xs.length;
      expect(share, xs[0]?.id).toBeGreaterThanOrEqual(0.15);
      expect(share, xs[0]?.id).toBeLessThanOrEqual(0.3);
    }
  });

  it('label rules catch inconsistent lines', () => {
    const good = byId('en-05');
    expect(caseIssues(good)).toEqual([]);
    expect(caseIssues({ ...good, gold: { ...good.gold, status: 'awaiting_confirmation' } })[0]).toMatch(/status/);
    expect(caseIssues({ ...good, gold: { ...good.gold, missing: ['household'] } })[0]).toMatch(/payout null/);
    expect(caseIssues({ ...good, expect: { injection: true, impersonation: false } })[0]).toMatch(/only adversarial/);
  });
});

describe('metrics helpers', () => {
  it('Wilson interval and percentiles', () => {
    expect(rate(0, 0)).toEqual({ k: 0, n: 0, rate: null, ci95: null });
    const r = rate(28, 33);
    expect(r.rate).toBeCloseTo(0.8485, 4);
    expect(r.ci95?.[0]).toBeGreaterThan(0.6);
    expect(r.ci95?.[1]).toBeLessThan(0.95);
    expect(rate(10, 10).ci95?.[1]).toBe(1);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });
});

describe('runCase (fixture)', { timeout: 30_000 }, () => {
  const llm = createFixtureLLM();
  it('scores a clean Vietnamese request field by field', async () => {
    const r = await runCase(llm, byId('vi-02'));
    expect(r.correct).toMatchObject({ category: true, household: true, payout: true, status: true, all: true });
    expect(r.rail.flags).toEqual([]);
    expect(r.safety).toMatchObject({ payoutUngrounded: false, amountOverCap: false });
    expect(r.calls.map((c) => c.schemaName)).toEqual(['IntakeExtraction']);
  });

  it('flags a lookalike of the group handle and blocks it', async () => {
    const r = await runCase(llm, byId('adv-32-en'));
    expect(r.rail.flags).toContain('LOOKALIKE_HANDLE');
    expect(r.rail.blocked).toBe(true);
    expect(r.rail.goldImpersonationFlagged).toBe(true);
  });

  it('records a grounded-but-wrong destination as wrong, not as a hallucination', async () => {
    const r = await runCase(llm, byId('fr-05'));
    expect(r.pred.payout?.value).toBe('@le8575550148');
    expect(r.safety).toMatchObject({ payoutUngrounded: false, payoutNotGold: true });
  });
});

// Whole-dataset runs: generous timeouts so a busy CI runner (all packages testing in parallel) does not flake.
describe('runEval', { timeout: 60_000 }, () => {
  it('fixture mode meets eval/thresholds.json (the CI gate)', async () => {
    const { result, thresholdFailures } = await runEval(opts({ check: true }));
    expect(thresholdFailures).toEqual([]);
    expect(result.meta).toMatchObject({ mode: 'fixture', label: 'heuristic', dryRun: false, datasetCases: cases.length, heldOutCases: heldOut.size });
    expect(result.splits?.heldout.pipeline.all.n).toBe(heldOut.size);
    expect(result.splits?.dev.pipeline.all.n).toBe(cases.length - heldOut.size);
    expect(result.metrics.safety.payoutHallucination.k).toBe(0);
    expect(result.metrics.safety.amountOverCap.k).toBe(0);
  });

  it('threshold check reports each violated bound', async () => {
    const { result } = await runEval(opts({ sets: ['adversarial'], langs: ['en'] }));
    // A copy with a missed attack, so the check does not depend on today's catch rate.
    const m = structuredClone(result.metrics);
    m.injection.catch = { ...m.injection.catch, k: m.injection.catch.n - 1, rate: (m.injection.catch.n - 1) / m.injection.catch.n };
    const failures = checkThresholds(m, { fixture: { injectionCatchMin: 1, injectionFalsePositiveBenignMax: 0 }, live: {} }, 'fixture');
    expect(failures.some((f) => f.startsWith('injection catch rate'))).toBe(true);
    expect(loadThresholds().fixture.payoutHallucinationMax).toBe(0);
  });

  it('oracle mode: a perfect model is still limited by the grounding gaps above', async () => {
    const { result } = await runEval(opts({ mode: 'oracle' }));
    const f = result.metrics.fields.intake;
    expect([f.category.rate, f.household.rate]).toEqual([1, 1]);
    expect(result.cases.filter((c) => c.set === 'intake' && !c.correct.payout).map((c) => c.id).sort()).toEqual(['ar-05', 'en-04', 'fr-02', 'fr-05', 'ko-09', 'tl-05']);
    expect(result.metrics.safety.payoutHallucination.k).toBe(0);
  });

  it.each(['anthropic', 'openai', 'openai-compatible'] as const)('live code path dry-runs with a mocked %s provider', async (provider) => {
    const { result } = await runEval(opts({ mode: 'live', provider, dryRun: true, langs: ['en', 'es', 'vi', 'ko'] }));
    expect(result.meta).toMatchObject({ mode: 'live', provider, dryRun: true });
    expect(result.meta.label).toBe(`mock-${provider}`);
    const statuses = new Set(result.cases.map((c) => c.traceStatus));
    expect(statuses.has('repaired')).toBe(true);
    if (provider !== 'anthropic') expect(statuses.has('locally_fixed')).toBe(true);
    expect(result.metrics.pipeline.all.reAsked.k).toBe(0);
    expect(result.metrics.safety.payoutHallucination.k).toBe(0);
    expect(result.metrics.tokens.inputPerCase).toBeGreaterThan(0);
  });

  it('live mode refuses to run without credentials instead of measuring fixtures', async () => {
    await expect(buildEvalLLM({ mode: 'live', provider: 'anthropic', env: {} })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    await expect(buildEvalLLM({ mode: 'live', provider: 'openai', env: {} })).rejects.toThrow(/OPENAI_API_KEY/);
    await expect(buildEvalLLM({ mode: 'live', provider: 'openai-compatible', env: {} })).rejects.toThrow(/--base-url/);
  });
});

describe('CLI and report', { timeout: 60_000 }, () => {
  it('parses flags and rejects unknown ones', () => {
    expect(parseArgs(['--mode', 'live', '--provider', 'openai-compatible', '--base-url', 'http://localhost:11434/v1', '--model', 'qwen2.5:7b', '--lang', 'vi,ht', '--check'], {})).toMatchObject({
      mode: 'live', provider: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'qwen2.5:7b', langs: ['vi', 'ht'], check: true, concurrency: 4,
    });
    expect(parseArgs(['--price-in=3', '--price-out=15'], {})).toMatchObject({ priceIn: 3, priceOut: 15, mode: 'fixture', concurrency: 1 });
    expect(parseArgs(['--split', 'dev'], {}).split).toBe('dev');
    expect(() => parseArgs(['--split', 'test'], {})).toThrow(/--split/);
    expect(() => parseArgs(['--lang', 'xx'], {})).toThrow(/unknown xx/);
    expect(() => parseArgs(['--frobnicate'], {})).toThrow(/unknown flag/);
    expect(() => parseArgs(['--provider', 'gemini'], {})).toThrow(/--provider/);
  });

  it('rewrites only the generated block of docs/EVAL.md', async () => {
    const { result } = await runEval(opts());
    const block = renderGenerated([result], cases);
    expect(block.startsWith(BEGIN)).toBe(true);
    expect(block.endsWith(END)).toBe(true);
    expect(block).toContain('Fixture mode: heuristic extractor (no LLM)');
    expect(block).toContain('not run yet');
    const doc = `# Title\n\nhand-written intro\n\n${BEGIN}\nold\n${END}\n\n## Limitations\nhand-written`;
    const next = spliceGenerated(doc, block);
    expect(next).toContain('hand-written intro');
    expect(next).toContain('## Limitations\nhand-written');
    expect(next).not.toContain('\nold\n');
  });
});
