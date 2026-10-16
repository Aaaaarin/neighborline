/**
 * Markdown for docs/EVAL.md. Only the block between the GENERATED markers is rewritten; the
 * methodology, findings and limitations around it are written by hand.
 */
import type { EvalCase } from './dataset.js';
import { EVAL_LANGS } from './dataset.js';
import type { Metrics, Rate } from './metrics.js';
import type { CaseResult } from './run-case.js';

export interface ResultMeta {
  date: string;
  mode: 'fixture' | 'oracle' | 'live';
  provider: string;
  model: string;
  label: string;
  dryRun: boolean;
  measures: string;
  datasetSha256: string;
  datasetCases: number;
  filters: { langs: string[] | null; sets: string[] | null; limit: number | null; split?: 'dev' | 'heldout' };
  /** How many of the run's cases are in the held-out split (dataset/heldout.txt). */
  heldOutCases?: number;
  gitCommit: string | null;
  node: string;
  durationMs: number;
  prices: { inPerM: number; outPerM: number } | null;
}

export interface ResultFile {
  meta: ResultMeta;
  metrics: Metrics;
  /** The same metrics on the dev split and on the held-out split (absent in results from before the split). */
  splits?: { dev: Metrics; heldout: Metrics };
  cases: CaseResult[];
}

export const BEGIN = '<!-- BEGIN GENERATED: pnpm --filter @neighborline/agents eval (do not edit by hand) -->';
export const END = '<!-- END GENERATED -->';

const pct = (r: Rate): string => (r.rate === null ? 'n/a' : `${(r.rate * 100).toFixed(1)}%`);
const frac = (r: Rate): string => `${r.k}/${r.n}`;
const ci = (r: Rate): string => (r.ci95 ? `${(r.ci95[0] * 100).toFixed(0)}–${(r.ci95[1] * 100).toFixed(0)}%` : '');
/** "96.2% (25/26, 95% CI 81–99%)" */
const full = (r: Rate): string => (r.rate === null ? 'n/a (0 cases)' : `**${pct(r)}** (${frac(r)}, 95% CI ${ci(r)})`);
const cell = (r: Rate): string => (r.rate === null ? '–' : `${pct(r)} (${frac(r)})`);
const ms = (v: number | null): string => (v === null ? '–' : v < 1 ? `${v.toFixed(2)} ms` : v < 1000 ? `${v.toFixed(0)} ms` : `${(v / 1000).toFixed(2)} s`);

const LANG_NAME: Record<string, string> = {
  en: 'English', es: 'Spanish', vi: 'Vietnamese', ht: 'Haitian Creole', zh: 'Chinese', ar: 'Arabic', ko: 'Korean', ru: 'Russian', fr: 'French', tl: 'Tagalog',
};

export function runTitle(m: ResultMeta): string {
  if (m.mode === 'fixture') return 'Fixture mode: heuristic extractor (no LLM)';
  if (m.mode === 'oracle') return 'Oracle: gold labels as the model (pipeline ceiling)';
  return `${m.dryRun ? 'Dry run (MOCK model)' : 'Live'}: ${m.provider} ${m.model}`;
}

function datasetTable(cases: readonly EvalCase[]): string {
  const sets = ['intake', 'adversarial', 'benign'] as const;
  const rows = EVAL_LANGS.map((l) => `| ${LANG_NAME[l]} (\`${l}\`) | ${sets.map((s) => cases.filter((c) => c.lang === l && c.set === s).length).join(' | ')} |`);
  const total = `| **Total** | ${sets.map((s) => `**${cases.filter((c) => c.set === s).length}**`).join(' | ')} |`;
  return ['| Language | Intake (labeled) | Adversarial | Benign controls |', '|---|---|---|---|', ...rows, total].join('\n');
}

function runSection(r: ResultFile): string {
  const { meta, metrics: m } = r;
  const fi = m.fields.intake;
  const fb = m.fields.benign;
  const p = m.pipeline;
  const out: string[] = [];
  out.push(`### ${runTitle(meta)}`, '');
  out.push(`- **What is measured:** ${meta.measures}`);
  out.push(`- Run ${meta.date.slice(0, 16).replace('T', ' ')} UTC · commit \`${meta.gitCommit?.slice(0, 7) ?? 'unknown'}\` · dataset \`${meta.datasetSha256.slice(0, 12)}\` (${meta.datasetCases} cases${meta.heldOutCases !== undefined ? `, ${meta.heldOutCases} held out` : ''}) · Node ${meta.node} · ${ms(meta.durationMs)} total`);
  if (meta.filters.langs || meta.filters.sets || meta.filters.limit) out.push(`- Filters: ${JSON.stringify(meta.filters)}`);
  out.push('');
  if (r.splits) out.push('**Dev vs held-out** (rules are tuned on dev only; see "Held-out split" below)', '', splitTable(r), '');

  out.push('**Schema pipeline** (generate → zod + grounding → one repair → re-ask)', '');
  out.push('| Set | n | Schema-valid on first output | of which local fix only | Repaired (1 extra call) | Kept, ungrounded fields dropped | Re-asked (no usable record) | Needs clarification |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const [name, x] of [['intake', p.intake], ['adversarial', p.adversarial], ['benign', p.benign], ['**all**', p.all]] as const) {
    out.push(`| ${name} | ${x.n} | ${cell(x.schemaValidFirstOutput)} | ${cell(x.locallyFixed)} | ${cell(x.repaired)} | ${cell(x.keptAfterDrop)} | ${cell(x.reAsked)} | ${cell(x.needsClarification)} |`);
  }
  out.push('', '"Kept": the output was schema-valid but a field failed grounding twice (once more after the repair call), so that field was dropped and the rest kept.', '');

  out.push('**Field accuracy** (exact match against the human label)', '');
  out.push('| Set | n | Category | Household size | Payout destination | `missing[]` | Status | All four* | Language id |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const [name, f] of [['intake', fi], ['benign controls', fb]] as const) {
    out.push(`| ${name} | ${f.n} | ${cell(f.category)} | ${cell(f.household)} | ${cell(f.payout)} | ${cell(f.missing)} | ${cell(f.status)} | ${cell(f.allFour)} | ${cell(f.lang)} |`);
  }
  out.push('', '\\* category, household size, payout destination and status all correct.', '');
  out.push(
    `Payout, intake set: of ${fi.payoutGiven.exact.n} requests that gave a destination, ${frac(fi.payoutGiven.exact)} were extracted exactly, ` +
      `${frac(fi.payoutGiven.notExtracted)} were not extracted (the neighbor is asked for it) and ${frac(fi.payoutGiven.wrong)} were extracted **wrong**. ` +
      `Of ${fi.payoutInvented.n} requests that gave none, ${frac(fi.payoutInvented)} got an invented one. ` +
      `Stated-amount recall: ${cell(fi.statedAmountRecall)}${meta.mode === 'fixture' ? ' (the offline extractor never extracts amounts, by design)' : ''}.`,
    '',
  );

  out.push('**Per language** (intake set)', '');
  out.push('| Language | n | Category | Household | Payout | Status | All four | Schema-valid first output |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const l of m.perLanguage) {
    out.push(`| ${LANG_NAME[l.lang]} | ${l.n} | ${cell(l.category)} | ${cell(l.household)} | ${cell(l.payout)} | ${cell(l.status)} | ${cell(l.allFour)} | ${cell(l.schemaValidFirstOutput)} |`);
  }
  out.push('');

  out.push('**Payout destination by how it was given** (intake + benign)', '');
  out.push('| Format | n | Exact |', '|---|---|---|');
  for (const x of m.payoutByFormat) out.push(`| \`${x.tag}\` | ${x.n} | ${cell(x.exact)} |`);
  out.push('');

  out.push('**Safety invariants** (must be 0 by construction; measured, not assumed)', '');
  out.push('| Invariant | Rate |', '|---|---|');
  out.push(`| Payout hallucination: extracted destination not in the transcript | ${full(m.safety.payoutHallucination)} |`);
  out.push(`| Computed amount above the category or household cap | ${full(m.safety.amountOverCap)} |`);
  out.push(`| Extracted destination ≠ labeled destination (intake + benign; grounded but wrong) | ${full(m.safety.payoutNotGold)} |`);
  out.push(`| Extracted amount ≠ the amount the person stated | ${full(m.safety.amountNotGold)} |`);
  out.push('');

  const inj = m.injection;
  out.push('**Prompt injection** (core `checkRail` on original + English text → `PROMPT_INJECTION` review flag)', '');
  out.push(`- Catch rate on injection attempts: ${full(inj.catch)}`);
  out.push(`- False positives on benign controls: ${full(inj.falsePositiveBenign)}`);
  out.push(`- False positives on ordinary intake requests: ${full(inj.falsePositiveIntake)}`);
  out.push(`- By language: ${inj.catchByLang.map((x) => `${x.lang} ${frac(x.rate)}`).join(' · ')}`);
  out.push(`- Missed: ${inj.missed.length ? inj.missed.map((id) => `\`${id}\``).join(', ') : 'none'}`);
  out.push(`- Flagged although benign: ${inj.falsePositives.length ? inj.falsePositives.map((id) => `\`${id}\``).join(', ') : 'none'}`, '');

  const imp = m.impersonation;
  out.push('**Impersonation of the group or an organizer** (`LOOKALIKE_HANDLE` / `DEST_IS_GROUP_HANDLE`, both block payout)', '');
  out.push(`- Caught end to end (on the extracted destination): ${full(imp.catch)}`);
  out.push(`- Not extracted, so the neighbor is asked for a destination instead (nothing can be paid): ${full(imp.notExtracted)}`);
  out.push(`- Caught by the rail alone (on the labeled destination): ${full(imp.catchRailOnly)}`);
  out.push(`- False positives, end to end (legitimate extracted destinations): ${full(imp.falsePositive)}`);
  out.push(`- False positives, rail alone (legitimate labeled destinations): ${full(imp.falsePositiveRailOnly)}`);
  out.push(`- Missed end to end: ${imp.missed.length ? imp.missed.map((id) => `\`${id}\``).join(', ') : 'none'}`);
  out.push(`- Legitimate destinations flagged: ${imp.falsePositives.length ? imp.falsePositives.map((id) => `\`${id}\``).join(', ') : 'none'}`, '');

  const t = m.tokens;
  out.push('**Latency and cost**', '');
  out.push(`- Model time per intake: p50 ${ms(m.latency.modelMsP50)}, p95 ${ms(m.latency.modelMsP95)} · wall time per intake: p50 ${ms(m.latency.wallMsP50)}, p95 ${ms(m.latency.wallMsP95)}`);
  out.push(
    `- Per intake: ${t.callsPerCase} model calls, ~${t.inputPerCase} input + ~${t.outputPerCase} output tokens` +
      (meta.mode === 'fixture' ? ' (characters ÷ 4 of the exact prompts a live model would receive; the heuristic writes far less output than a model would)' : '') +
      (t.usdPer1000 !== null && meta.prices ? ` · **≈ $${t.usdPer1000} per 1,000 intakes** at $${meta.prices.inPerM}/M input and $${meta.prices.outPerM}/M output tokens` : ' · cost: pass `--price-in` / `--price-out` (USD per million tokens) to estimate'),
  );
  out.push('');
  return out.join('\n');
}

/** Key metrics, one row each: [label, pick]. Shared by the headline and the dev / held-out table. */
const KEY_ROWS: Array<[string, (m: Metrics) => Rate]> = [
  ['Injection attempts flagged for review', (m) => m.injection.catch],
  ['Benign controls wrongly flagged as injection', (m) => m.injection.falsePositiveBenign],
  ['Impersonating destinations blocked (end to end)', (m) => m.impersonation.catch],
  ['Impersonating destinations blocked (rail alone)', (m) => m.impersonation.catchRailOnly],
  ['Legitimate destinations wrongly blocked', (m) => m.impersonation.falsePositive],
  ['Payout destinations not in the transcript', (m) => m.safety.payoutHallucination],
  ['Grounded but wrong destination (intake + benign)', (m) => m.safety.payoutNotGold],
  ['Category correct (intake)', (m) => m.fields.intake.category],
  ['Household size correct (intake)', (m) => m.fields.intake.household],
  ['Payout destination exactly right (intake)', (m) => m.fields.intake.payout],
  ['Status correct (intake)', (m) => m.fields.intake.status],
];

function headline(r: ResultFile): string {
  const m = r.metrics;
  return [
    '| Metric | Value |',
    '|---|---|',
    ...KEY_ROWS.map(([label, pick]) => `| ${label} | ${full(pick(m))} |`),
    `| Schema-valid on first output / repaired / re-asked | ${pct(m.pipeline.all.schemaValidFirstOutput)} / ${pct(m.pipeline.all.repaired)} / ${pct(m.pipeline.all.reAsked)} |`,
  ].join('\n');
}

/**
 * Dev vs held-out. Rules are tuned on dev only; the held-out ids (dataset/heldout.txt) were set
 * aside before tuning, so a gap between the two columns is the overfitting signal.
 */
function splitTable(r: ResultFile): string {
  if (!r.splits) return '';
  const { dev, heldout } = r.splits;
  return [
    '| Metric | All | Dev (tuned on) | Held-out (never tuned on) |',
    '|---|---|---|---|',
    ...KEY_ROWS.map(([label, pick]) => `| ${label} | ${cell(pick(r.metrics))} | ${cell(pick(dev))} | ${cell(pick(heldout))} |`),
  ].join('\n');
}

/** The generated block: dataset, headline of the newest fixture run, then every run (newest first per kind). */
export function renderGenerated(results: readonly ResultFile[], cases: readonly EvalCase[]): string {
  const real = results.filter((r) => !r.meta.dryRun);
  const fixture = real.filter((r) => r.meta.mode === 'fixture').sort((a, b) => b.meta.date.localeCompare(a.meta.date))[0];
  const latestPerModel = new Map<string, ResultFile>();
  for (const r of [...real].sort((a, b) => a.meta.date.localeCompare(b.meta.date))) latestPerModel.set(`${r.meta.mode}:${r.meta.label}`, r);
  const order = { live: 0, fixture: 1, oracle: 2 } as const;
  const runs = [...latestPerModel.values()].sort((a, b) => order[a.meta.mode] - order[b.meta.mode] || b.meta.date.localeCompare(a.meta.date));
  const out: string[] = [BEGIN, ''];
  out.push('## Dataset', '', datasetTable(cases), '');
  if (fixture) {
    out.push(`## Headline: ${runTitle(fixture.meta)}, ${fixture.meta.date.slice(0, 10)}`, '');
    out.push('> These numbers measure the **offline keyword extractor**, not a language model. The rail, grounding and validation code is the production code. Live-model numbers appear below once a run with API keys has been committed.', '');
    out.push(headline(fixture), '');
    if (fixture.splits) out.push('Dev vs held-out for the same run:', '', splitTable(fixture), '');
  }
  out.push('## Runs', '');
  out.push('| Run | Date | Injection caught | Benign flagged | Impersonation blocked | Category | Household | Payout | Status | Schema-valid 1st / repaired / re-asked |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const m = r.metrics;
    out.push(
      `| ${runTitle(r.meta)} | ${r.meta.date.slice(0, 10)} | ${pct(m.injection.catch)} | ${pct(m.injection.falsePositiveBenign)} | ${pct(m.impersonation.catch)} | ${pct(m.fields.intake.category)} | ${pct(m.fields.intake.household)} | ${pct(m.fields.intake.payout)} | ${pct(m.fields.intake.status)} | ${pct(m.pipeline.all.schemaValidFirstOutput)} / ${pct(m.pipeline.all.repaired)} / ${pct(m.pipeline.all.reAsked)} |`,
    );
  }
  if (!runs.some((r) => r.meta.mode === 'live')) out.push('| Live model (Claude / OpenAI / local) | – | not run yet: needs API keys or a local server | | | | | | | |');
  out.push('');
  for (const r of runs) out.push(runSection(r));
  out.push(END);
  return out.join('\n');
}

/** Replace the generated block in `doc` (or append it when the markers are missing). */
export function spliceGenerated(doc: string, generated: string): string {
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a >= 0 && b > a) return `${doc.slice(0, a)}${generated}${doc.slice(b + END.length)}`;
  return `${doc.trimEnd()}\n\n${generated}\n`;
}
