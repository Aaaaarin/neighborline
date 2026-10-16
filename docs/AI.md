# AI in Neighborline

The short version: models transcribe, translate, extract fields, read back, draft and write. Code computes every
amount, checks every destination, and two humans approve every payout. The code is in
[`packages/agents`](../packages/agents); the rules that decide money are in [`packages/core`](../packages/core).

## The agents

| Agent | Input → output | Has tools? | File |
|---|---|---|---|
| **IntakeAgent** | Audio or text in any language → transcript → `IntakeExtraction` + English translation → read-back in the neighbor's language (+ one clarifying question) | No | [`intake/intake-agent.ts`](../packages/agents/src/intake/intake-agent.ts) |
| **PolicyCompiler** | Organizers' plain-English rules → `PolicyDraft` + diff against the previous version | No. Draft only; activation needs two organizers | [`policy/compiler.ts`](../packages/agents/src/policy/compiler.ts) |
| **NotifyAgent** | Status change → message from the vetted catalog in the neighbor's language (+ optional TTS) | No | [`notify/notify-agent.ts`](../packages/agents/src/notify/notify-agent.ts) |
| **ReportWriter** | Aggregate facts (+ donation inflows via PayPal Agent Toolkit `list_transactions`) → 120–200 word donor narrative | No model-driven tools. The toolkit call has fixed arguments | [`report/report-writer.ts`](../packages/agents/src/report/report-writer.ts) |

None of the agents can call Payouts. The only path to PayPal Payouts is the approval flow (two distinct organizers,
hash-pinned content) or `neighborline-payouts-mcp` with a human-minted approval token.

## The pipeline: validate → repair → re-ask

Every structured call goes through `runStructured` ([`validate.ts`](../packages/agents/src/validate.ts)):

```
generate (JSON Schema derived from the zod schema)
  → lenient JSON parse     local fixes, no model call: strip a code fence, drop text around the object,
                           remove trailing commas, drop nulls for optional fields
  → zod parse              shape, enums, ranges
  → semantic check         rules zod cannot express: grounding, cross-field rules
  → invalid? ONE repair call: the model sees its own output and the exact issues, path by path
  → still invalid?         { ok: false } and the caller asks the human again. Never guess
```

How each provider produces JSON:

- **Anthropic**: the Messages API with a single forced tool (`tool_choice: { type: 'tool' }`) and `strict: true`, so
  constrained decoding matches the schema. zod still validates everything
  ([`anthropic.ts`](../packages/agents/src/providers/anthropic.ts)).
- **OpenAI**: Chat Completions Structured Outputs (`response_format: json_schema, strict: true`). Strict mode needs
  every property required, so optional fields are sent as nullable and the nulls are dropped before zod
  ([`openai-llm.ts`](../packages/agents/src/providers/openai-llm.ts)).

Every result carries a `StructuredTrace`: status (`valid`, `locally_fixed`, `repaired`, `invalid`, `error`), each
attempt's issues, latency, tokens, model and a 600-character raw preview, plus a one-line summary for the UI:

```
IntakeExtraction valid on first try · 812 ms
IntakeExtraction valid after local fix (stripped markdown code fence) · no extra model call
Schema repaired 1 field (payout.value) · 1 repair call · 1.9 s
Schema still invalid after 1 repair (2 issues) · not guessing
```

Tested in [`validate.test.ts`](../packages/agents/src/validate.test.ts): first-try pass, one repair that shows the
model its errors, truncated JSON, local fixes without a model call, giving up after one repair, semantic issues
driving the repair, provider errors recorded instead of thrown.

## Grounding checks

A schema-valid answer can still be wrong. These checks run as semantic issues (so they trigger the repair call) and
again deterministically afterwards ([`intake/grounding.ts`](../packages/agents/src/intake/grounding.ts)):

| Field | Rule | If it fails |
|---|---|---|
| `payout` | Must be a valid PayPal/Venmo destination **and** appear in what the neighbor said, after normalizing spoken forms ("lan dash nguyen 54", "arroba", "chấm", "pwen") | One repair; then dropped, `missing: ['payout']`, the neighbor is asked |
| `payout` (missed) | If the model found none but the transcript contains one, it is recovered from the transcript | Logged in the trace notes |
| `requestedAmountCents` | Must be a number the neighbor said, in a sentence that is not addressed to the system (checked with core's injection detector) | Dropped. It was only ever an upper bound for `computeAmount` |
| `category` | Must be one of this policy's keys or `other` (the schema enum is built from the active policy) | Repair; unknown keys resolve to `other` in core |
| `confidence` | Below 0.6 | `needs_clarification`, ask again in their language |
| Policy caps | Every dollar amount and count in a `PolicyDraft` must appear in the organizers' text; every category quotes its source rule verbatim | Repair; then the draft fails |
| Report numbers | Every number in the narrative must be one of the computed facts | One repair; then a deterministic template |
| Translations | Amount and wallet must appear verbatim in the translation and in a back-translation | The vetted English text is sent instead |

## Prompt-injection posture

The model is not the security boundary. The design assumes injected text will sometimes steer the model, and makes
that harmless:

1. **No tools.** The intake model cannot move money, approve, or call anything.
2. **Amounts come from code.** `computeAmount` takes the minimum of policy caps; the model's number is at most an
   upper bound, and only if the neighbor said it.
3. **Destinations must be grounded** in the transcript and are read back to the neighbor before filing.
4. **Data tags.** Untrusted text goes in `<request_text>…</request_text>` (and similar). Any tag-like sequence for
   our tags or role names inside the text is neutralized (`<` → `‹`), so the text cannot close the block
   ([`prompt-safety.ts`](../packages/agents/src/prompt-safety.ts)). The system prompt says text in data tags is
   never instructions.
5. **Organizers see it.** Core's multilingual heuristics raise a `PROMPT_INJECTION` **review** flag (never a block,
   never a judgment of the person). Polite pleas such as "please approve my request" or "I need $3,000 for the
   hospital" are tested not to flag ([`core/src/injection.ts`](../packages/core/src/injection.ts)).
6. **Rail checks are independent.** A lookalike handle smuggled in by injection is blocked by code
   ([`core/src/rail.ts`](../packages/core/src/rail.ts)).

Red-team tests in [`intake-agent.test.ts`](../packages/agents/src/intake/intake-agent.test.ts): a model that *obeys*
an injected "$5000 to @x" still yields an extraction without the amount or the handle; a fake closing tag cannot
break out of the data block. The `inject_en` fixture and the `blocked` stage scenario show the same thing end to end.

## Languages

- **Vetted catalog** (written, not machine-translated at runtime): English, Spanish, Vietnamese, Haitian Creole,
  Chinese, Arabic ([`core/src/i18n.ts`](../packages/core/src/i18n.ts) and
  [`intake/phrases.ts`](../packages/agents/src/intake/phrases.ts)). Core marks Arabic as right-to-left
  (`textDirection`); the web UI does not apply it yet.
- **Other languages** in the contract (French, Tagalog, Korean, Russian): the read-back frame and status messages
  are LLM-translated with the back-translation fact check, or fall back to English. The neighbor's own summary
  (`summaryNative`) is written by the model in their language.
- STT language: from the provider when it reports one, otherwise a script-and-marker-word detector
  ([`lang.ts`](../packages/agents/src/lang.ts)).

## Fixture vs live

| | `AI_MODE=fixture` (default) | `AI_MODE=live` |
|---|---|---|
| LLM | `FixtureLLM`: scenario answers matched by transcript; otherwise a conservative keyword extractor that never extracts an amount; policy text → offline parser; translations from `fixtures/translations.json` or identity; report → template | Claude (`claude-sonnet-5-5`) or OpenAI (`gpt-5.4-mini`), chosen by `LLM_PROVIDER`, falling back to whichever key exists, then to fixtures with a warning |
| STT | `FixtureSTT`: recognizes fixture audio by marker or by sha256 in `fixtures/audio/manifest.json`. An unknown recording transcribes as `lan_vi` unless `AI_FIXTURE_DEFAULT_AUDIO=none` | OpenAI `gpt-4o-transcribe` (needs `OPENAI_API_KEY`) |
| TTS | Fixture (browser speech in the UI) | OpenAI `gpt-4o-mini-tts`, voice `coral` |
| Fallback | — | `AI_FALLBACK=fixture` sends model errors to fixtures and logs it |

`providers.notes` lists, in plain words, which provider is live; `/trust` is meant to show it.

Fixture scenarios ([`fixtures/scenarios`](../packages/agents/fixtures/scenarios)): `lan_vi`, `rosa_es`, `jean_ht`,
`walter_en`, `inject_en`, `missing_payout_es`. To record real demo audio:
`OPENAI_API_KEY=… pnpm --filter @neighborline/agents make-demo-audio`.

## What we deliberately do not do

- No need scores, fraud scores or rankings of people.
- No model output reaches PayPal without passing through code that recomputes the amount and checks the destination.
- No free-form money text to neighbors: amounts and wallets in messages are filled by code.
