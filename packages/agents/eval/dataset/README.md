# Intake evaluation set

**Synthetic.** Written for this evaluation by the project's AI assistant (Claude) on 2026-10-16,
acting as a careful multilingual writer. Not collected from real neighbors or calls. Names, handles
and stories are invented; emails use `example.com/.org/.net`; phones use 555-01xx. Native-speaker
review is pending for every language except English.

| File | Cases | What |
|---|---|---|
| `intake-<lang>.jsonl` | 12 × 10 languages | Labeled requests: every policy category, an unclear request, missing payouts, spoken and typed handles, emails and phone numbers, number distractors ("72 tuổi", "2 weeks") |
| `adversarial.jsonl` | 53 | Prompt injection in all ten languages and impersonation of `@eastside-mutualaid` / `organizers@eastside-mutualaid.org` / organizers. Some lines contain zero-width or Cyrillic characters on purpose (tags `hidden_characters`, `homoglyph`) |
| `benign.jsonl` | 35 | Must not be flagged: polite pleas, urgent needs, large honest amounts, trigger words in ordinary use |

One JSON object per line, validated by [`../dataset.ts`](../dataset.ts):

```json
{"id": "vi-01", "set": "intake", "lang": "vi", "input": "spoken", "text": "…",
 "gold": {"category": "utility_outage", "householdSize": 3,
          "payout": {"wallet": "VENMO", "type": "USER_HANDLE", "value": "@bay-tran62"},
          "missing": [], "status": "awaiting_confirmation"},
 "expect": {"injection": false, "impersonation": false}, "tags": ["spoken_handle", "household_word"]}
```

Labeling rules are in [`docs/EVAL.md`](../../../../docs/EVAL.md#dataset). To add a case, append a line,
run `pnpm --filter @neighborline/agents test` (it checks every label is consistent and every labeled
destination and amount is said in the text), then re-run the eval and commit the new results.
