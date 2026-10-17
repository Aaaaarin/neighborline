# NOTES-security: requests to other lanes

## Scripted intake against a live-AI deployment needs a human pass (golive)

Since `999c1ef`, with `AI_MODE=live` (the hosted demo) every model-using intake call (`/api/intake/<id>/text`,
`/audio` with a real recording, `/confirm` with corrections, anonymous `/api/policy/draft`) answers
`403 {"code":"human_check_required"}` until the caller holds an `nl_human` cookie. A script (e.g.
`scripts/golive/src/lib/intake.ts`) should, with the same cookie jar as its intake calls:

1. `POST /api/human/challenge` with `{}` → `{kind:"pow", challenge, bits, count}` (or `none` / `passed`);
2. solve with `solvePow` from `apps/web/lib/pow.ts` (or the loop in `apps/web/e2e/helpers.ts` `passHumanCheck`);
3. `POST /api/human/verify` with `{kind:"pow", challenge, solution}` → sets `nl_human` (30 minutes, bound to the
   `nl_visitor` cookie, so keep both cookies).

If Turnstile keys are configured the challenge is `kind:"turnstile"` and a script cannot pass it; unset the keys or
run that step with `HUMAN_CHECK=pow`. Bundled samples (`sampleId`) and `/demo` never need a pass.
