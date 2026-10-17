# MCP agent demo: an agent that can only pay with two humans' signatures

An AI agent connects to [`neighborline-payouts-mcp`](../../packages/paypal) with the official
[MCP TypeScript client](https://github.com/modelcontextprotocol/typescript-sdk) over stdio, and tries to pay
Mrs. Lan $150 on Venmo.

1. It calls `create_payout_batch` without an approval token. **Refused**, with a reason it can tell its user.
2. Two organizers approve the exact batch. The approval service signs an HMAC token bound to it
   (`signApprovalToken` from `@neighborline/paypal/approval`, approvers `org_dana` + `org_marcus`).
3. The agent retries with the token. The batch is created in (fake) PayPal, and `get_payout_batch` shows `SUCCESS`.
4. `reconcile_payouts` matches the payout against PayPal Transaction Search.

Every call is real: the MCP server runs as a subprocess, and it talks to [`tools/fake-paypal`](../../tools/fake-paypal)
(in-process, no credentials) or to the PayPal sandbox.

```bash
pnpm install
pnpm --filter @neighborline/example-mcp-agent-demo demo                     # scripted, no keys, ~3 s
pnpm --filter @neighborline/example-mcp-agent-demo demo --typewriter 40     # paced for a screen recording
pnpm --filter @neighborline/example-mcp-agent-demo demo --tamper            # + the agent edits the amount: refused
pnpm --filter @neighborline/example-mcp-agent-demo demo --verbose           # + raw tool arguments, results, audit log

ANTHROPIC_API_KEY=… pnpm --filter @neighborline/example-mcp-agent-demo demo:llm anthropic   # a real model drives it
OPENAI_API_KEY=…    pnpm --filter @neighborline/example-mcp-agent-demo demo:llm openai
```

Output of the scripted run (the batch id and transaction id change per run):

```
MCP client → neighborline-payouts v0.2.0 (stdio) · fake PayPal · scripted agent
6 tools: get_payout_batch, get_payout_item, cancel_unclaimed_payout_item, search_transactions, reconcile_payouts, create_payout_batch

── 1. The agent tries to pay on its own ────────────────────────────────
user   Pay Mrs. Lan $150 on Venmo (@lan-nguyen54) for her heating bill.
agent  → create_payout_batch $150.00 → @lan-nguyen54 (Venmo) · no approval_token
mcp    ✗ Refused: no approval_token; an agent cannot authorize a payout on its own. Payouts need two human approvals in the Neighborline organizer app.
agent  I can't send money on my own. Asking two organizers to approve this exact payout.

── 2. Two organizers sign ──────────────────────────────────────────────
human  Dana (organizer) approved $150.00 → @lan-nguyen54 (Venmo) · 1 of 2
human  Marcus (organizer) approved $150.00 → @lan-nguyen54 (Venmo) · 2 of 2
token  HMAC-signed for this batch only (digest 63163a5265…) · org_dana + org_marcus · expires in 10 min
         nlap1.eyJ2IjoxLCJh…NKn0K3jk

── 3. The agent retries with the token ─────────────────────────────────
agent  → create_payout_batch $150.00 → @lan-nguyen54 (Venmo) · approval_token ✓
mcp    ✓ batch OVCTVW2125BEH · PENDING · approval appr_001
agent  → get_payout_batch OVCTVW2125BEH
mcp    ✓ batch SUCCESS · @lan-nguyen54 $150.00 VENMO: SUCCESS · txn 0G1A61CJPU863480T

── 4. Reconcile against PayPal ─────────────────────────────────────────
agent  → reconcile_payouts 1 ledger item vs Transaction Search
mcp    ✓ ok · 1 matched · 0 mismatched · 0 missing · 0 within PayPal's reporting lag

$150.00 → @lan-nguyen54 (Venmo) paid with two humans' signatures. 1 refusal, 1 payout, reconciled.
```

## Flags

| Flag | Default | |
|---|---|---|
| `--scripted` / `--llm [anthropic\|openai]` | scripted | `--llm` picks the provider from the positional or from whichever key is set |
| `--model <id>` | `ANTHROPIC_MODEL` or `claude-sonnet-5-5`; `OPENAI_MODEL` or `gpt-5.4-mini` | |
| `--approve auto\|prompt` | `auto` | `--llm` only. `prompt` asks you, as each organizer, on the terminal |
| `--typewriter [cps]` | off (45 cps when given without a value) | Types each line, pauses between events |
| `--pause <ms>` | 0 (450 with `--typewriter`) | |
| `--tamper` | off | Adds the agent changing $150 to $1,500 with a valid token: refused |
| `--verbose` | off | Raw tool arguments and results, and the server's `[audit]` lines |
| `--json <file>` | | Saves the transcript (used by `scripts/record-video.mjs`) |
| `--paypal fake\|sandbox` | `fake` | `sandbox` needs `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` |
| `--server source\|built` | `source` | `built` runs `packages/paypal/dist/mcp/bin.js` (run the package build first) |
| `MCP_SERVER_COMMAND` env | | Any server command, e.g. `npx -y --package=@neighborline/paypal neighborline-payouts-mcp` |

## How the `--llm` mode works

A plain tool-calling loop over the Anthropic Messages API or OpenAI Chat Completions (`src/llm.ts`). The model gets
the six MCP tools, as listed by the server, plus one local tool, `request_human_approval`. That tool hands the batch
to the demo approval service (`src/approval-service.ts`), which returns a token only after two different organizers
approve. The model never sees the HMAC secret; it can only carry the token from one tool to the other, and the server
refuses the token if the model changes anything in the batch. Both loops are tested with scripted fake model clients
(`src/llm.test.ts`); a real model needs your key.

## Try it from Claude Desktop

See [docs/MCP.md](../../docs/MCP.md#claude-desktop). `pnpm --filter @neighborline/example-mcp-agent-demo sign` plays
the approval service there: it mints a token for the batch Claude proposed once you name two approvers.

## Recording

`pnpm --filter @neighborline/example-mcp-agent-demo record` runs the scripted demo, renders the transcript as a
1920×1080 terminal in the app's fonts, and captures it frame by frame with Playwright (deterministic, no screen
recorder) into `$VIDEO_OUT/takes/mcp-demo.mp4` (default `/home/claude/video-out`), plus a still in
`docs/submission/video/mcp-demo.png`.
