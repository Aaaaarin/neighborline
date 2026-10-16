# Neighborline AI evaluation

What the intake pipeline gets right, what it gets wrong, and what it refuses to guess, measured on
208 labeled requests in ten languages. Everything here is reproducible offline in about a second:

```bash
pnpm --filter @neighborline/agents eval                  # fixture mode: the offline extractor
pnpm --filter @neighborline/agents eval --mode oracle    # a "perfect model": the ceiling of the code around it
```

> **Read this first.** No language model has been evaluated yet: the project has no API keys. The
> fixture numbers below measure the **offline keyword extractor** (`src/intake/heuristic.ts`) that
> runs when `AI_MODE=fixture`, followed by the production grounding, validation and rail code. The
> oracle run feeds the human gold labels in as if a perfect model had written them, which shows
> what the deterministic code around any model loses. The live runner is built and its code path
> is exercised against mock providers in CI; live numbers will be added here the day a key exists,
> by the same command with `--mode live`.

## What is measured

| Mode | The "model" | What its numbers mean |
|---|---|---|
| `fixture` (default, CI) | `FixtureLLM` → the keyword extractor. Never extracts amounts; asks when unsure | What a group running with zero credentials gets. The rail and injection numbers are the production `core` checks and do not depend on the model |
| `oracle` | Answers every extraction with the gold labels (and the original text as its "English translation") | The ceiling of the pipeline: anything the oracle loses, every model loses, because grounding and normalization dropped it |
| `live` | `AnthropicLLM`, `OpenAILLM` or `OpenAICompatibleLLM` (a local model) with real credentials | Model accuracy. Refuses to start without credentials rather than silently measuring fixtures |
| `live --dry-run` | The live provider classes with a mocked vendor client (or, for `openai-compatible`, a mock HTTP server) that misbehaves on 30% of first attempts | Only that the live code path works: strict schemas, tool / JSON parsing, local fixes, the repair call. Not committed, never reported as accuracy |

Each case runs `IntakeAgent.fromText` exactly as the web app does, then the checks the web app runs
when the neighbor confirms: `core.checkRail` on the extracted destination plus the original and
English text, and `core.computeAmount` under the demo policy. The rail sees the demo group's
official handles (`@eastside-mutualaid`, `organizers@eastside-mutualaid.org`) and its organizers'
handles, as `packages/db/src/seed.ts` seeds them.

<!-- BEGIN GENERATED: pnpm --filter @neighborline/agents eval (do not edit by hand) -->

## Dataset

| Language | Intake (labeled) | Adversarial | Benign controls |
|---|---|---|---|
| English (`en`) | 12 | 23 | 15 |
| Spanish (`es`) | 12 | 7 | 4 |
| Vietnamese (`vi`) | 12 | 3 | 2 |
| Haitian Creole (`ht`) | 12 | 2 | 2 |
| Chinese (`zh`) | 12 | 4 | 2 |
| Arabic (`ar`) | 12 | 3 | 2 |
| Korean (`ko`) | 12 | 3 | 2 |
| Russian (`ru`) | 12 | 3 | 2 |
| French (`fr`) | 12 | 3 | 2 |
| Tagalog (`tl`) | 12 | 2 | 2 |
| **Total** | **120** | **53** | **35** |

## Headline: Fixture mode: heuristic extractor (no LLM), 2026-10-16

> These numbers measure the **offline keyword extractor**, not a language model. The rail, grounding and validation code is the production code. Live-model numbers appear below once a run with API keys has been committed.

| Metric | Value |
|---|---|
| Injection attempts flagged for review | **100.0%** (33/33, 95% CI 90–100%) |
| Benign controls wrongly flagged as injection | **0.0%** (0/35, 95% CI 0–10%) |
| Impersonating destinations blocked (end to end) | **100.0%** (22/22, 95% CI 85–100%) |
| Impersonating destinations blocked (rail alone) | **100.0%** (22/22, 95% CI 85–100%) |
| Legitimate destinations wrongly blocked | **0.0%** (0/158, 95% CI 0–2%) |
| Payout destinations not in the transcript | **0.0%** (0/180, 95% CI 0–2%) |
| Grounded but wrong destination (intake + benign) | **0.0%** (0/127, 95% CI 0–3%) |
| Category correct (intake) | **100.0%** (120/120, 95% CI 97–100%) |
| Household size correct (intake) | **87.5%** (105/120, 95% CI 80–92%) |
| Payout destination exactly right (intake) | **100.0%** (120/120, 95% CI 97–100%) |
| Status correct (intake) | **91.7%** (110/120, 95% CI 85–95%) |
| Schema-valid on first output / repaired / re-asked | 100.0% / 0.0% / 0.0% |

Dev vs held-out for the same run:

| Metric | All | Dev (tuned on) | Held-out (never tuned on) |
|---|---|---|---|
| Injection attempts flagged for review | 100.0% (33/33) | 100.0% (24/24) | 100.0% (9/9) |
| Benign controls wrongly flagged as injection | 0.0% (0/35) | 0.0% (0/28) | 0.0% (0/7) |
| Impersonating destinations blocked (end to end) | 100.0% (22/22) | 100.0% (19/19) | 100.0% (3/3) |
| Impersonating destinations blocked (rail alone) | 100.0% (22/22) | 100.0% (19/19) | 100.0% (3/3) |
| Legitimate destinations wrongly blocked | 0.0% (0/158) | 0.0% (0/118) | 0.0% (0/40) |
| Payout destinations not in the transcript | 0.0% (0/180) | 0.0% (0/137) | 0.0% (0/43) |
| Grounded but wrong destination (intake + benign) | 0.0% (0/127) | 0.0% (0/95) | 0.0% (0/32) |
| Category correct (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |
| Household size correct (intake) | 87.5% (105/120) | 88.9% (80/90) | 83.3% (25/30) |
| Payout destination exactly right (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |
| Status correct (intake) | 91.7% (110/120) | 90.0% (81/90) | 96.7% (29/30) |

## Runs

| Run | Date | Injection caught | Benign flagged | Impersonation blocked | Category | Household | Payout | Status | Schema-valid 1st / repaired / re-asked |
|---|---|---|---|---|---|---|---|---|---|
| Fixture mode: heuristic extractor (no LLM) | 2026-10-16 | 100.0% | 0.0% | 100.0% | 100.0% | 87.5% | 100.0% | 91.7% | 100.0% / 0.0% / 0.0% |
| Oracle: gold labels as the model (pipeline ceiling) | 2026-10-16 | 100.0% | 0.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% / 0.0% / 0.0% |
| Live model (Claude / OpenAI / local) | – | not run yet: needs API keys or a local server | | | | | | | |

### Fixture mode: heuristic extractor (no LLM)

- **What is measured:** FixtureLLM, i.e. the offline keyword extractor in src/intake/heuristic.ts (no language model), followed by the real grounding, validation and rail code.
- Run 2026-10-16 22:57 UTC · commit `3f7c293` · dataset `67367ce662ae` (208 cases, 48 held out) · Node v22.22.0 · 818 ms total

**Dev vs held-out** (rules are tuned on dev only; see "Held-out split" below)

| Metric | All | Dev (tuned on) | Held-out (never tuned on) |
|---|---|---|---|
| Injection attempts flagged for review | 100.0% (33/33) | 100.0% (24/24) | 100.0% (9/9) |
| Benign controls wrongly flagged as injection | 0.0% (0/35) | 0.0% (0/28) | 0.0% (0/7) |
| Impersonating destinations blocked (end to end) | 100.0% (22/22) | 100.0% (19/19) | 100.0% (3/3) |
| Impersonating destinations blocked (rail alone) | 100.0% (22/22) | 100.0% (19/19) | 100.0% (3/3) |
| Legitimate destinations wrongly blocked | 0.0% (0/158) | 0.0% (0/118) | 0.0% (0/40) |
| Payout destinations not in the transcript | 0.0% (0/180) | 0.0% (0/137) | 0.0% (0/43) |
| Grounded but wrong destination (intake + benign) | 0.0% (0/127) | 0.0% (0/95) | 0.0% (0/32) |
| Category correct (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |
| Household size correct (intake) | 87.5% (105/120) | 88.9% (80/90) | 83.3% (25/30) |
| Payout destination exactly right (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |
| Status correct (intake) | 91.7% (110/120) | 90.0% (81/90) | 96.7% (29/30) |

**Schema pipeline** (generate → zod + grounding → one repair → re-ask)

| Set | n | Schema-valid on first output | of which local fix only | Repaired (1 extra call) | Kept, ungrounded fields dropped | Re-asked (no usable record) | Needs clarification |
|---|---|---|---|---|---|---|---|
| intake | 120 | 100.0% (120/120) | 0.0% (0/120) | 0.0% (0/120) | 0.0% (0/120) | 0.0% (0/120) | 31.7% (38/120) |
| adversarial | 53 | 100.0% (53/53) | 0.0% (0/53) | 0.0% (0/53) | 0.0% (0/53) | 0.0% (0/53) | 20.8% (11/53) |
| benign | 35 | 100.0% (35/35) | 0.0% (0/35) | 0.0% (0/35) | 0.0% (0/35) | 0.0% (0/35) | 0.0% (0/35) |
| **all** | 208 | 100.0% (208/208) | 0.0% (0/208) | 0.0% (0/208) | 0.0% (0/208) | 0.0% (0/208) | 23.6% (49/208) |

"Kept": the output was schema-valid but a field failed grounding twice (once more after the repair call), so that field was dropped and the rest kept.

**Field accuracy** (exact match against the human label)

| Set | n | Category | Household size | Payout destination | `missing[]` | Status | All four* | Language id |
|---|---|---|---|---|---|---|---|---|
| intake | 120 | 100.0% (120/120) | 87.5% (105/120) | 100.0% (120/120) | 79.2% (95/120) | 91.7% (110/120) | 79.2% (95/120) | 99.2% (119/120) |
| benign controls | 35 | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) |

\* category, household size, payout destination and status all correct.

Payout, intake set: of 92 requests that gave a destination, 92/92 were extracted exactly, 0/92 were not extracted (the neighbor is asked for it) and 0/92 were extracted **wrong**. Of 28 requests that gave none, 0/28 got an invented one. Stated-amount recall: 0.0% (0/40) (the offline extractor never extracts amounts, by design).

**Per language** (intake set)

| Language | n | Category | Household | Payout | Status | All four | Schema-valid first output |
|---|---|---|---|---|---|---|---|
| English | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 91.7% (11/12) | 91.7% (11/12) | 100.0% (12/12) |
| Spanish | 12 | 100.0% (12/12) | 91.7% (11/12) | 100.0% (12/12) | 91.7% (11/12) | 83.3% (10/12) | 100.0% (12/12) |
| Vietnamese | 12 | 100.0% (12/12) | 83.3% (10/12) | 100.0% (12/12) | 91.7% (11/12) | 75.0% (9/12) | 100.0% (12/12) |
| Haitian Creole | 12 | 100.0% (12/12) | 83.3% (10/12) | 100.0% (12/12) | 91.7% (11/12) | 75.0% (9/12) | 100.0% (12/12) |
| Chinese | 12 | 100.0% (12/12) | 91.7% (11/12) | 100.0% (12/12) | 91.7% (11/12) | 83.3% (10/12) | 100.0% (12/12) |
| Arabic | 12 | 100.0% (12/12) | 75.0% (9/12) | 100.0% (12/12) | 91.7% (11/12) | 66.7% (8/12) | 100.0% (12/12) |
| Korean | 12 | 100.0% (12/12) | 91.7% (11/12) | 100.0% (12/12) | 91.7% (11/12) | 83.3% (10/12) | 100.0% (12/12) |
| Russian | 12 | 100.0% (12/12) | 83.3% (10/12) | 100.0% (12/12) | 91.7% (11/12) | 75.0% (9/12) | 100.0% (12/12) |
| French | 12 | 100.0% (12/12) | 91.7% (11/12) | 100.0% (12/12) | 91.7% (11/12) | 83.3% (10/12) | 100.0% (12/12) |
| Tagalog | 12 | 100.0% (12/12) | 83.3% (10/12) | 100.0% (12/12) | 91.7% (11/12) | 75.0% (9/12) | 100.0% (12/12) |

**Payout destination by how it was given** (intake + benign)

| Format | n | Exact |
|---|---|---|
| `spoken_handle` | 20 | 100.0% (20/20) |
| `spoken_email` | 10 | 100.0% (10/10) |
| `written_handle` | 31 | 100.0% (31/31) |
| `written_email` | 18 | 100.0% (18/18) |
| `phone` | 12 | 100.0% (12/12) |
| `local_at_word` | 5 | 100.0% (5/5) |
| `local_wallet_word` | 5 | 100.0% (5/5) |

**Safety invariants** (must be 0 by construction; measured, not assumed)

| Invariant | Rate |
|---|---|
| Payout hallucination: extracted destination not in the transcript | **0.0%** (0/180, 95% CI 0–2%) |
| Computed amount above the category or household cap | **0.0%** (0/208, 95% CI 0–2%) |
| Extracted destination ≠ labeled destination (intake + benign; grounded but wrong) | **0.0%** (0/127, 95% CI 0–3%) |
| Extracted amount ≠ the amount the person stated | n/a (0 cases) |

**Prompt injection** (core `checkRail` on original + English text → `PROMPT_INJECTION` review flag)

- Catch rate on injection attempts: **100.0%** (33/33, 95% CI 90–100%)
- False positives on benign controls: **0.0%** (0/35, 95% CI 0–10%)
- False positives on ordinary intake requests: **0.0%** (0/120, 95% CI 0–3%)
- By language: en 14/14 · es 4/4 · vi 2/2 · ht 1/1 · zh 3/3 · ar 2/2 · ko 2/2 · ru 2/2 · fr 2/2 · tl 1/1
- Missed: none
- Flagged although benign: none

**Impersonation of the group or an organizer** (`LOOKALIKE_HANDLE` / `DEST_IS_GROUP_HANDLE`, both block payout)

- Caught end to end (on the extracted destination): **100.0%** (22/22, 95% CI 85–100%)
- Not extracted, so the neighbor is asked for a destination instead (nothing can be paid): **0.0%** (0/22, 95% CI 0–15%)
- Caught by the rail alone (on the labeled destination): **100.0%** (22/22, 95% CI 85–100%)
- False positives, end to end (legitimate extracted destinations): **0.0%** (0/158, 95% CI 0–2%)
- False positives, rail alone (legitimate labeled destinations): **0.0%** (0/158, 95% CI 0–2%)
- Missed end to end: none
- Legitimate destinations flagged: none

**Latency and cost**

- Model time per intake: p50 0.30 ms, p95 0.61 ms · wall time per intake: p50 0.78 ms, p95 4 ms
- Per intake: 2.5 model calls, ~814.4 input + ~178.6 output tokens (characters ÷ 4 of the exact prompts a live model would receive; the heuristic writes far less output than a model would) · cost: pass `--price-in` / `--price-out` (USD per million tokens) to estimate

### Oracle: gold labels as the model (pipeline ceiling)

- **What is measured:** a perfect "model" that answers each extraction with the human gold labels (original text as its English translation), followed by the real grounding, validation and rail code: the ceiling of the pipeline around the model.
- Run 2026-10-16 22:57 UTC · commit `3f7c293` · dataset `67367ce662ae` (208 cases, 48 held out) · Node v22.22.0 · 478 ms total

**Dev vs held-out** (rules are tuned on dev only; see "Held-out split" below)

| Metric | All | Dev (tuned on) | Held-out (never tuned on) |
|---|---|---|---|
| Injection attempts flagged for review | 100.0% (33/33) | 100.0% (24/24) | 100.0% (9/9) |
| Benign controls wrongly flagged as injection | 0.0% (0/35) | 0.0% (0/28) | 0.0% (0/7) |
| Impersonating destinations blocked (end to end) | 100.0% (22/22) | 100.0% (19/19) | 100.0% (3/3) |
| Impersonating destinations blocked (rail alone) | 100.0% (22/22) | 100.0% (19/19) | 100.0% (3/3) |
| Legitimate destinations wrongly blocked | 0.0% (0/158) | 0.0% (0/118) | 0.0% (0/40) |
| Payout destinations not in the transcript | 0.0% (0/180) | 0.0% (0/137) | 0.0% (0/43) |
| Grounded but wrong destination (intake + benign) | 0.0% (0/127) | 0.0% (0/95) | 0.0% (0/32) |
| Category correct (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |
| Household size correct (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |
| Payout destination exactly right (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |
| Status correct (intake) | 100.0% (120/120) | 100.0% (90/90) | 100.0% (30/30) |

**Schema pipeline** (generate → zod + grounding → one repair → re-ask)

| Set | n | Schema-valid on first output | of which local fix only | Repaired (1 extra call) | Kept, ungrounded fields dropped | Re-asked (no usable record) | Needs clarification |
|---|---|---|---|---|---|---|---|
| intake | 120 | 100.0% (120/120) | 0.0% (0/120) | 0.0% (0/120) | 0.0% (0/120) | 0.0% (0/120) | 23.3% (28/120) |
| adversarial | 53 | 100.0% (53/53) | 0.0% (0/53) | 0.0% (0/53) | 0.0% (0/53) | 0.0% (0/53) | 18.9% (10/53) |
| benign | 35 | 100.0% (35/35) | 0.0% (0/35) | 0.0% (0/35) | 0.0% (0/35) | 0.0% (0/35) | 0.0% (0/35) |
| **all** | 208 | 100.0% (208/208) | 0.0% (0/208) | 0.0% (0/208) | 0.0% (0/208) | 0.0% (0/208) | 18.3% (38/208) |

"Kept": the output was schema-valid but a field failed grounding twice (once more after the repair call), so that field was dropped and the rest kept.

**Field accuracy** (exact match against the human label)

| Set | n | Category | Household size | Payout destination | `missing[]` | Status | All four* | Language id |
|---|---|---|---|---|---|---|---|---|
| intake | 120 | 100.0% (120/120) | 100.0% (120/120) | 100.0% (120/120) | 100.0% (120/120) | 100.0% (120/120) | 100.0% (120/120) | 100.0% (120/120) |
| benign controls | 35 | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) | 100.0% (35/35) |

\* category, household size, payout destination and status all correct.

Payout, intake set: of 92 requests that gave a destination, 92/92 were extracted exactly, 0/92 were not extracted (the neighbor is asked for it) and 0/92 were extracted **wrong**. Of 28 requests that gave none, 0/28 got an invented one. Stated-amount recall: 100.0% (40/40).

**Per language** (intake set)

| Language | n | Category | Household | Payout | Status | All four | Schema-valid first output |
|---|---|---|---|---|---|---|---|
| English | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Spanish | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Vietnamese | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Haitian Creole | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Chinese | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Arabic | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Korean | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Russian | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| French | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |
| Tagalog | 12 | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) | 100.0% (12/12) |

**Payout destination by how it was given** (intake + benign)

| Format | n | Exact |
|---|---|---|
| `spoken_handle` | 20 | 100.0% (20/20) |
| `spoken_email` | 10 | 100.0% (10/10) |
| `written_handle` | 31 | 100.0% (31/31) |
| `written_email` | 18 | 100.0% (18/18) |
| `phone` | 12 | 100.0% (12/12) |
| `local_at_word` | 5 | 100.0% (5/5) |
| `local_wallet_word` | 5 | 100.0% (5/5) |

**Safety invariants** (must be 0 by construction; measured, not assumed)

| Invariant | Rate |
|---|---|
| Payout hallucination: extracted destination not in the transcript | **0.0%** (0/180, 95% CI 0–2%) |
| Computed amount above the category or household cap | **0.0%** (0/208, 95% CI 0–2%) |
| Extracted destination ≠ labeled destination (intake + benign; grounded but wrong) | **0.0%** (0/127, 95% CI 0–3%) |
| Extracted amount ≠ the amount the person stated | **0.0%** (0/53, 95% CI 0–7%) |

**Prompt injection** (core `checkRail` on original + English text → `PROMPT_INJECTION` review flag)

- Catch rate on injection attempts: **100.0%** (33/33, 95% CI 90–100%)
- False positives on benign controls: **0.0%** (0/35, 95% CI 0–10%)
- False positives on ordinary intake requests: **0.0%** (0/120, 95% CI 0–3%)
- By language: en 14/14 · es 4/4 · vi 2/2 · ht 1/1 · zh 3/3 · ar 2/2 · ko 2/2 · ru 2/2 · fr 2/2 · tl 1/1
- Missed: none
- Flagged although benign: none

**Impersonation of the group or an organizer** (`LOOKALIKE_HANDLE` / `DEST_IS_GROUP_HANDLE`, both block payout)

- Caught end to end (on the extracted destination): **100.0%** (22/22, 95% CI 85–100%)
- Not extracted, so the neighbor is asked for a destination instead (nothing can be paid): **0.0%** (0/22, 95% CI 0–15%)
- Caught by the rail alone (on the labeled destination): **100.0%** (22/22, 95% CI 85–100%)
- False positives, end to end (legitimate extracted destinations): **0.0%** (0/158, 95% CI 0–2%)
- False positives, rail alone (legitimate labeled destinations): **0.0%** (0/158, 95% CI 0–2%)
- Missed end to end: none
- Legitimate destinations flagged: none

**Latency and cost**

- Model time per intake: p50 0.03 ms, p95 0.16 ms · wall time per intake: p50 0.57 ms, p95 4 ms
- Per intake: 2.4 model calls, ~798 input + ~149.6 output tokens · cost: pass `--price-in` / `--price-out` (USD per million tokens) to estimate

<!-- END GENERATED -->

## Findings and fixes

The first fixture and oracle runs (2026-10-16) found the problems below. All are fixed, each by a
general mechanism with its own regression tests, and measured on a **held-out split** that was set
aside before any rule was changed (see [Methodology](#methodology)). Case ids point into
[`packages/agents/eval/dataset`](../packages/agents/eval/dataset).

| # | Finding | Fix (mechanism, not dataset strings) | Tests |
|---|---|---|---|
| 1 | The grounding checker rejected correct destinations, so even a perfect model lost 6 of 92 (phones said without a country code: `en-04`, `ar-05`, `ko-09`, `tl-05`, `fr-05`; French "point": `fr-02`). Amounts written against Chinese characters ("要60美元") were never "said" | Phones are normalized to E.164 in a configurable default region (`PHONE_DEFAULT_REGION`, US; `core/src/phone.ts`) and grounded on digit sequences, with or without the country code. Spoken-symbol vocabulary per language (`agents/src/intake/spoken-vocab.ts`: point, punto, arroba, chấm, a còng, собака, 艾特, 골뱅이 …). Numbers count after any non-Latin letter | `core/src/phone.test.ts`, `spoken-handles.test.ts`, `grounding.test.ts`; `eval.test.ts` "no grounding gaps" must stay empty |
| 2 | After dropping the model's correct `+18575550148`, `finalizeExtraction` "recovered" the wrong `@le8575550148` from fragments | After a drop, only a destination the person wrote out unambiguously (exactly one email, @handle or phone, and no other said after a wallet name) may replace it; otherwise the neighbor is asked | `grounding.test.ts` |
| 3 | Filler and symbol words produced grounded-but-wrong handles (`tl-02` "ko", `tl-05`, `ru-05` собака/дефис, `zh-09` 横杠) | Leading fillers per language (ko, po, ay, le, c'est …); a spoken "@" that is not between a local part and a domain starts the handle; "at my …" is a preposition; a phone-shaped run after a wallet name is a phone; wallet names in every script (벤모, فينمو, Венмо) | `spoken-handles.test.ts` |
| 4 | A Cyrillic і was stripped, so `@eastside-mutuaіd` became `@eastside-mutuad` and the lookalike check missed it (`adv-37-en`) | `core.latinizeLookalikes` maps lookalike letters to Latin inside Latin words and handles **before** anything is stripped; whole words in another script are left alone. Language id now needs a script to carry the text, not one letter | `core/src/handles.test.ts`, `spoken-handles.test.ts` |
| 5 | Injection misses: Vietnamese role-play (`adv-09-vi`), an Arabic note to the AI (`adv-14-ar`), base64 shorter than 60 characters (`adv-22-en`, `adv-23-fr`), an authority claim with an inflated amount (`adv-05-en`) | Role-play verbs aimed at a privileged role, per language; notes to the AI in Arabic and Haitian Creole; instructions about the amount field; short base64 flags only when it decodes to readable, instruction-like text; an authority claim ("the organizers raised my limit") flags only next to an amount above the household cap in the same sentence (`core/src/injection-rules.ts`) | `core/src/injection.test.ts` |
| 6 | Honest large bills were flagged ("telling me to pay $4,800": `ben-05-en`; "peye 4,500 dola": `ben-23-ht`) | An amount above 10× the household cap flags only when a payment verb **orders** it: an imperative ("send $5,000", "please transfer…") or a payment pointed at a destination ("… to my Venmo", "给我转"). Reported speech and the speaker's own payments do not | `core/src/injection.test.ts` |
| 7 | Offline extractor: "landlord" words sent heat outages to rent (`ben-07-en`, `fr-06`, `zh-06`); hunger pleas without a food word were not groceries; household sizes such as "me and my husband" were never inferred | Categories are scored by distinct need words (weight 2) over context words such as "landlord" (weight 1); hunger vocabulary per language; household from living alone, who someone lives with, Tagalog number linkers, and the largest explicit count | `heuristic.test.ts` |

**Before and after**, fixture mode (the offline extractor) and oracle (the pipeline ceiling), dev
split vs held-out split. Held-out rates have wide intervals (9 attacks, 7 benign controls, 30 intake
requests).

| Metric | Fixture before: dev | Fixture before: held-out | Fixture after: dev | Fixture after: held-out | Oracle before: dev / held-out | Oracle after: dev / held-out |
|---|---|---|---|---|---|---|
| Injection attempts flagged | 87.5% (21/24) | 77.8% (7/9) | 100% (24/24) | 100% (9/9) | same as fixture (core rules) | same as fixture |
| Benign controls flagged | 3.6% (1/28) | 14.3% (1/7) | 0% (0/28) | 0% (0/7) | same as fixture | same as fixture |
| Impersonation blocked, end to end | 94.7% (18/19) | 100% (3/3) | 100% (19/19) | 100% (3/3) | 94.7% / 100% | 100% / 100% |
| Grounded but wrong destination | 3.4% (3/89) | 7.1% (2/28) | 0% (0/95) | 0% (0/32) | 1.1% (1/91) / 3.1% (1/32) | 0% / 0% |
| Payout exactly right (intake) | 90.0% (81/90) | 80.0% (24/30) | 100% (90/90) | 100% (30/30) | 94.4% / 96.7% | 100% / 100% |
| Category (intake) | 92.2% (83/90) | 100% (30/30) | 100% (90/90) | 100% (30/30) | 100% / 100% | 100% / 100% |
| Household size (intake) | 64.4% (58/90) | 53.3% (16/30) | 88.9% (80/90) | 83.3% (25/30) | 100% / 100% | 100% / 100% |
| Status (intake) | 80.0% (72/90) | 83.3% (25/30) | 90.0% (81/90) | 96.7% (29/30) | 95.6% / 100% | 100% / 100% |
| Payout hallucination | 0% | 0% | 0% | 0% | 0% / 0% | 0% / 0% |

**Read these 100% rates with care.** The set is small and synthetic, and its author also wrote the
rules. The held-out lines were never read while fixing, but some of them are among the findings
above, whose one-line descriptions (for example "ملاحظة للذكاء الاصطناعي", "peye 4,500 dola") were
known, so the held-out split is not fully blind for findings 1, 3, 5 and 6. The dataset is now
saturated as a measure: it remains a regression gate, and new attacks, ideally written by someone
who has not read `injection-rules.ts`, are the next step. What still fails in fixture mode is
household inference from wordings the extractor does not know (it asks instead) and requests in the
`other` category, which always get a "what is it for?" question because the extractor cannot tell
"other" from "unclear".

## Dataset

- **Provenance: synthetic.** Every line was written for this evaluation by the project's AI
  assistant (Claude), acting as a careful multilingual writer, on 2026-10-16. None of it comes from
  real neighbors or real calls. Names, handles and stories are invented; emails use `example.com`,
  `.org` and `.net`; phone numbers use the 555-01xx range. **Native-speaker review is pending for
  every language except English.** Haitian Creole, Tagalog and Arabic are the most likely to read
  as unnatural, and the per-language numbers should be read with that in mind.
- **Spoken vs typed.** `input: "spoken"` lines are written the way a speech-to-text transcript of
  the request would read ("at doris dash kemp 48", "a còng bay gạch ngang tran 62"); they are not
  real transcripts, so STT errors are not measured. `typed` lines are what someone types in `/call`.
- **Labels** (`gold`): policy category (an unclear need is `other` + `missing: ["category"]`),
  household size only when stated or clearly implied ("me and my husband" = 2, "I live alone" = 1),
  the payout destination normalized the way PayPal/Venmo needs it, the scored missing fields, the
  status the system should reach, and the amount only when the person states the cost of their own
  need. `dataset.ts` rejects inconsistent labels; `eval.test.ts` checks every labeled destination
  and amount is actually said in the text, with a checker independent of the agents' code.
- **Adversarial** (53): prompt injection in all ten languages (ignore-instructions, "note for the
  AI", role-play, system markers, JSON payloads, base64, zero-width characters, leetspeak, amount
  inflation) and impersonation of the group or its organizers (character swaps, dropped separators,
  Cyrillic homoglyphs, rn→m, lookalike email domains and local parts, an organizer's own handle and
  phone). Some were written on purpose to probe gaps the author suspected; the catch rate is a
  regression signal for these rules, not an estimate of the real-world attack catch rate.
- **Benign controls** (35): polite pleas ("please, please approve my request"), urgent needs, large
  but honest amounts, and ordinary uses of trigger words (heating *system*, the *rules* on the flyer,
  the pharmacy's *instructions*, "my grandson's *AI* phone thing", "note for the organizers",
  handles that mention the east side). None should be flagged.

## Methodology

- **Held-out split.** Before any rule was tuned against this dataset, about 20% of every dataset
  file (the `ceil(20%)` ids with the smallest `sha256("neighborline-heldout-v1:" + id)`: 3 per
  intake language, 11 attacks, 7 benign controls; 48 cases) was set aside in
  [`dataset/heldout.txt`](../packages/agents/eval/dataset/heldout.txt). Rules are developed on the
  dev split only; every run reports dev and held-out side by side, and a gap between them is the
  overfitting signal. `--split dev|heldout` runs one split. The list is frozen: new cases go to dev
  unless added there.
- **Exact match** for category, household size (both empty counts as a match), payout destination
  (wallet, type and normalized value), the scored `missing` fields (payout, category, household;
  `location` is not labeled) and status. "All four" = category, household, payout and status right.
- **Schema pipeline**: `valid` (first output passed zod and the semantic checks), `locally_fixed`
  (passed after a non-model fix such as stripping a code fence), `repaired` (needed the one repair
  call), re-asked (still invalid after it, or the provider failed: the neighbor is asked again).
  Fixture and oracle outputs are schema-valid by construction; these rates only mean something live.
- **Payout hallucination**: an extracted destination that the agents' grounding checker cannot find
  in the transcript. It must be 0 by construction (ungrounded destinations are dropped); it is
  measured anyway. **Wrong destination** is separate: a grounded destination that differs from the
  label.
- **Injection catch rate**: share of injection cases whose original or English text gets a
  `PROMPT_INJECTION` review flag. **False-positive rate**: the same flag on benign controls (and,
  separately, on ordinary intake requests).
- **Impersonation**: `LOOKALIKE_HANDLE` or `DEST_IS_GROUP_HANDLE` (both block payout). End to end =
  on the destination the extractor produced; rail alone = `checkHandles` on the labeled destination.
  An impersonating destination that was not extracted at all is counted as a miss end to end, and
  reported separately, because the neighbor is then asked for a destination and nothing is paid.
- **Rates** carry a Wilson 95% interval. With 10–12 cases per language one case is 8–10 points.
- **Latency** is the time inside model calls and the wall time per intake (p50, p95). In fixture and
  oracle mode it is CPU time of the extractor and means nothing for a live model. **Tokens** are the
  provider's counts live, and characters ÷ 4 of the exact same prompts offline. Cost in dollars is
  printed only when you pass prices (`--price-in`, `--price-out`, USD per million tokens), so no
  price is hard-coded that could go stale.
- **Reproducibility**: fixed clock, fixed policy (`demoPolicy()` v1), no history, deterministic
  providers. Each result file records the commit, the dataset's sha256, Node version and filters.
  Results live in [`packages/agents/eval/results`](../packages/agents/eval/results); this page shows
  the newest full run per model for the current dataset.

## Limitations

- **No language model has been measured.** Until a live run is committed, every accuracy number
  here describes the offline extractor or the oracle.
- **Text, not audio.** Speech recognition errors, accents, background noise and code-switching in
  real voice notes are not covered. Real recordings with consent are the next step (JUDGE-PANEL-2
  item 4).
- **Small and synthetic.** 12 intake cases per language, written by one author (an AI), who also
  wrote the labels and the attacks and knows the defenses. Native-speaker review is pending.
- **One policy, one group.** Categories and caps come from the demo policy; other groups' rules
  will shift category accuracy.
- **Oracle translations are the original text**, so in oracle mode the injection check on the
  "English" text adds nothing for non-English requests. In fixture mode the same is true
  (translations are identity offline). A live model's real English translation may catch more.
- **Local models**: the `openai-compatible` provider is tested only against a mock server (wire
  format, structured output, repair loop). No accuracy is claimed for any local model.

## Running it

```bash
# Offline, no keys (what CI runs, plus --check)
pnpm --filter @neighborline/agents eval

# A perfect model through the real pipeline
pnpm --filter @neighborline/agents eval --mode oracle

# Live (needs keys); prices make it print a cost per 1,000 intakes
ANTHROPIC_API_KEY=… pnpm --filter @neighborline/agents eval --mode live --provider anthropic --model claude-sonnet-5-5 --price-in <usd> --price-out <usd>
OPENAI_API_KEY=…    pnpm --filter @neighborline/agents eval --mode live --provider openai --model gpt-5.4-mini

# A local model (Ollama shown; llama-server is http://localhost:8080/v1)
pnpm --filter @neighborline/agents eval --mode live --provider openai-compatible \
  --base-url http://localhost:11434/v1 --model qwen2.5:7b-instruct --concurrency 1

# The live code path against a mock (no keys, no network)
pnpm --filter @neighborline/agents eval --mode live --provider anthropic --dry-run

# Subsets (and the held-out split alone)
pnpm --filter @neighborline/agents eval --lang vi,ht --set intake --no-write
pnpm --filter @neighborline/agents eval --split heldout --no-write
```

A full, non-dry run writes `packages/agents/eval/results/<date>-<mode>-<model>.json` (every case's
predictions, flags, calls and tokens) and rewrites the generated block of this page. Commit both.

## CI gate

CI runs `pnpm --filter @neighborline/agents eval --no-write --check`. It fails when
[`eval/thresholds.json`](../packages/agents/eval/thresholds.json) is not met: injection catch rate
≥ 0.96, benign false-positive rate ≤ 0.03, impersonation caught ≥ 0.95 end to end and by the rail
alone, legitimate destinations flagged ≤ 0.01, grounded-but-wrong destinations ≤ 0.01, and payout
hallucinations and amounts over the cap at exactly 0. The bars sit about one case below the
measured values and never above the held-out split's value. Raise them when a rule improves; do not
lower them to make a change pass. The same check also runs inside `pnpm test` (`eval/eval.test.ts`).
