# NOTES-agents — `@neighborline/agents` (AI lane)

Server-only package (uses `node:fs`, `Buffer`). Everything runs offline with `AI_MODE=fixture` (the default).

## Wiring (web)
1. `apps/web/package.json`: add `"@neighborline/agents": "workspace:*"`.
2. `apps/web/next.config.ts`: add `'@neighborline/agents'` to `transpilePackages`. Optional: `serverExternalPackages: ['@paypal/agent-toolkit']`
   (it is already loaded with a `webpackIgnore` dynamic import, so webpack never bundles it).
3. One module-level singleton:
   ```ts
   import { createAgents } from '@neighborline/agents';
   export const agents = createAgents(process.env, { groupName: 'Eastside Mutual Aid' });
   const categories = policy.categories.map((c) => ({ key: c.key, label: c.label.en ?? c.key }));
   ```

## Per route
| Route | Call | Notes |
|---|---|---|
| `POST /api/intake/:id/audio` | `agents.intake.fromAudio({ audio: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, categories, langHint?, speakReadBack: true, fixtureHint: { filename: file.name } })` | Respond `{ readBack, extraction, missing: extraction?.missing ?? [], clarifyingQuestion, status, transcript, trace }`. Store `originalText`, `englishText`, `lang`, `extraction`. Delete audio afterwards (privacy). |
| `POST /api/intake/:id/text` | `agents.intake.fromText({ text, categories, langHint? })` | Agent is stateless: for a clarification answer, re-run on `previousOriginalText + '\n' + answer`. |
| `POST /api/intake/:id/confirm` | core `computeAmount` + `checkRail({ text: [originalText, englishText] })`, then `agents.notify.render({ key: 'confirmed_waiting', lang })` | The agent never computes amounts. |
| webhook → notify | `const key = notifyKeyFor({ itemStatus }); if (key) await agents.notify.render({ key, lang: req.lang, amountCents: item.amountCents, wallet: item.wallet, name?, speak? })` | `result.text/lang/source` → `recordNotification` + `notify.sent` StageEvent. `source` = `catalog` \| `translated` (passed back-translation check) \| `catalog_en_fallback`. |
| policy editor | `agents.policy.compile({ sourceText, previous: activePolicy })` | Show `diffText`, `ambiguities`, `warnings`, `trace.summary`. Never activates: after 2 approvals call `db.activatePolicy({ ...draft, id, groupId, version: proposedVersion, createdAt, approvedBy })`. |
| `GET /api/report` | `agents.report.write({ report: buildReport(rows), groupName, categoryLabels, inflowSource, inflowRange })` | `inflowSource`: `new PayPalToolkitInflowSource({ clientId, clientSecret, sandbox: true })` when `PAYPAL_MODE=sandbox`, else `new FixtureInflowSource()`. Returns `headline`, `narrative`, `facts`, `numberTrace` (every number → fact key), `inflows`, `source` (`llm`/`template`), `trace`. |
| `/trust` | `agents.providers.mode`, `agents.providers.notes` | Honest "which AI is live" lines for the Sandbox-reality panel. |

## Showing the schema pipeline (judge-facing)
Every agent result has a `trace: StructuredTrace`:
- `trace.summary` — one line, e.g. `IntakeExtraction valid on first try · 812 ms`, `Schema repaired 1 field (payout.value) · 1 repair call · 1.9 s`,
  `IntakeExtraction valid after local fix (stripped markdown code fence) · no extra model call`, `Schema still invalid after 1 repair (2 issues) · not guessing`.
- `trace.status` — `valid | locally_fixed | repaired | invalid | error`; `trace.repairedFields`, `trace.localFixes`.
- `trace.attempts[]` — `{ kind: 'generate'|'repair', latencyMs, ok, issues: [{ path, message, source: 'json'|'schema'|'semantic'|'provider' }], rawPreview, usage, model }`.
- `trace.notes` — deterministic grounding steps: `payout normalized: "lan dash nguyen 54" → @lan-nguyen54`, `payout dropped: "@x" is not something the neighbor said`, `requested amount dropped: not stated by the person`.
Suggested UI: a small chip under the extraction ("✓ schema valid" / "repaired 1 field") that expands to the attempts with the raw output.

## Demo fixtures
`SCENARIOS` (`lan_vi`, `rosa_es`, `jean_ht`, `walter_en`, `inject_en`, `missing_payout_es`) carry transcript, English, expected extraction,
read-back, clarifying question, notification texts and `demo.amountCents/payoutOutcome`. `fixtureAudioBytes(id)` makes fake audio the
FixtureSTT recognizes; real mp3s come from `OPENAI_API_KEY=… pnpm --filter @neighborline/agents make-demo-audio` (writes
`fixtures/audio/<id>.mp3` + `manifest.json`, matched by sha256). An unrecognized recording in fixture mode transcribes as `lan_vi`
(`transcript.fixture.matchedBy === 'default'`; set `AI_FIXTURE_DEFAULT_AUDIO=none` to error instead).
`apps/web/lib/server/mock-text-intake.ts` can be replaced by `agents.intake.fromText` (note: it uses category key `medicine`; the core demo policy key is `medicine_copay`).

## Env (please add to root `.env.example`)
```
AI_MODE=fixture                 # fixture|live
LLM_PROVIDER=anthropic          # anthropic|openai (falls back to whichever key exists)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
ANTHROPIC_STRICT_TOOLS=true     # constrained decoding for the forced tool call
OPENAI_API_KEY=                 # also enables STT + TTS
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REASONING_EFFORT=        # optional: minimal|low|medium|high
OPENAI_STT_MODEL=gpt-4o-transcribe   # or gpt-4o-mini-transcribe, whisper-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=coral
AI_FALLBACK=                    # 'fixture' = live model errors fall back to fixtures (logged)
AI_FIXTURE_DEFAULT_AUDIO=lan_vi # or 'none'
AI_FIXTURE_AUDIO_DIR=           # override fixtures/audio location if bundling moves it
```

## Requests to other lanes
- **core (optional):** intake-only vetted phrases (`payout_line`, `ask_category`, `ask_location`, `ask_again`) live in
  `packages/agents/src/intake/phrases.ts` for en/es/vi/ht/zh/ar. Happy to move them into `CATALOG` if you add the keys.
  Catalog entries for fr/tl/ko/ru would remove the need for LLM translation in those languages.
- **web:** wiring above; render `trace.summary` next to every AI output.
