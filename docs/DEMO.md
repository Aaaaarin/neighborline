# Running and recording the demo

Everything here works with zero credentials: `pnpm i && pnpm dev`, then open `http://localhost:3000`.

> The stage currently runs on the web app's in-memory engine (see the integration note in the
> [README](../README.md#paypal-integration)). Scenario outcomes are scripted, PayPal ids are generated locally, and
> the rail shows "Sandbox: simulated".

## Scenarios

| `scenario=` | Who | Language | What happens | Amount |
|---|---|---|---|---|
| `lan` (default) | Mrs. Lan, Hawthorne | Vietnamese voice note | Power out 2 days after the ice storm. Venmo `@lan-nguyen54`. Two approvals → `SUCCESS` → "Đã gửi $150 vào Venmo của bạn" | $150, utility outage cap |
| `rosa` | Rosa, Foster-Powell | Spanish voice note | Groceries for 4. PayPal email. The item comes back `UNCLAIMED`, claim help goes out in Spanish, then she claims it → `SUCCESS` | $100, groceries cap |
| `jean` | Jean, Lents | Haitian Creole voice note | Insulin copay. PayPal by phone number | $60, the amount Jean said (under the $120 cap) |
| `walter` | Walter | English voice note | Rides to dialysis. Asked for $90 | $50, capped by the transport rule |
| `blocked` | "Impersonator" | English text | Injected instructions plus Venmo `@eastside-mutuaiaid`, one letter from the group's `@eastside-mutualaid`. Blocked by rail protection; both Approve buttons are disabled; no batch is created | — |

## URL parameters for `/demo`

| Parameter | Values | Effect |
|---|---|---|
| `scenario` | `lan`, `rosa`, `jean`, `walter`, `blocked` | Which story to load. Unknown values fall back to `lan` |
| `mode` | `auto` (default), `manual` | `manual`: Dana approves on her own, and **you** approve as Marcus. Same as the "I'll approve as Marcus" switch |
| `speed` | `0.25`–`20` (default 1) | Compresses the scripted pacing. The code path is identical |
| `autoplay` | `1` | Starts without pressing **Play scenario** |

Examples:

```
/demo?scenario=lan&autoplay=1                  # the hero shot, real-time pacing
/demo?scenario=lan&speed=3&autoplay=1          # the README screenshot
/demo?scenario=rosa&speed=2&autoplay=1         # unclaimed → rescued
/demo?scenario=blocked&autoplay=1              # lookalike handle blocked
/demo?scenario=lan&mode=manual                 # judge plays the second organizer
```

## Other pages

| Page | How to drive it |
|---|---|
| `/call` | The neighbor's phone on its own. Hold the record button (or press Space/Enter to toggle), type, or choose **No microphone? Use a sample** and pick Tiếng Việt, Español, Kreyòl ayisyen or English |
| `/organizer` | The approval queue on a phone-width page. Approve, or decline with a reason (the decline message is previewed in the neighbor's language) |
| `/donate` | Gift form. With `NEXT_PUBLIC_PAYPAL_CLIENT_ID` set, real PayPal JS SDK buttons (PayPal, Venmo, Pay Later, monthly); otherwise a labeled simulated button |
| `/report` | Donor transparency report with charts and table twins |
| `/trust` | Fiscal-sponsor checklist, agent permissions, principles, sandbox reality |
| `/ledger` | Payout items, states and reconcile status |

## HTTP controls (`DEMO_MODE=true`, the default)

```bash
# run a scenario through the server (same as the Play button)
curl -X POST localhost:3000/api/demo/play -H 'content-type: application/json' \
  -d '{"scenario":"jean","mode":"manual","speed":20}'

# approve as an organizer (idempotent: repeat it and nothing changes)
curl -X POST localhost:3000/api/approvals -H 'content-type: application/json' \
  -d '{"requestIds":["<requestId>"],"organizerId":"org_marcus","deviceLabel":"curl"}'

# reset the demo data
curl -X POST localhost:3000/api/demo/reset
```

Set `DEMO_MODE=false` to disable `/api/demo/*` (they return 403).

## Recording tips

- **Dark mode** ("blackout night") follows the OS setting (`prefers-color-scheme`). In Chrome DevTools, use
  *Rendering → Emulate CSS media feature prefers-color-scheme*.
- **Viewports:** the stage shows four columns from 1680 px wide, phones in a row with the rail below from 1024 px,
  and tabs below that. Record at 1920×1080.
- **Reduced motion** (`prefers-reduced-motion: reduce`) removes movement but keeps every state change, which is
  useful for a calm take.
- **Screenshots** for the README and Devpost:
  `BASE_URL=http://localhost:3000 node apps/web/scripts/screenshots.mjs` writes `apps/web/screenshots/*.png`
  (needs a Playwright Chromium; set `PLAYWRIGHT_BROWSERS_PATH` if it is installed somewhere else).
- The first 60 seconds of the video should stay on the neighbor's phone (SPEC §1).

## The local PayPal fake

The packages' tests and the planned real wiring use [`tools/fake-paypal`](../tools/fake-paypal):

```bash
WEBHOOK_TARGET_URL=http://localhost:3000/api/webhooks/paypal pnpm fake-paypal   # :4010
```

The receiver string decides each payout item's fate: anything containing `unclaimed` (e.g.
`rosa.unclaimed@example.com`) or a Venmo handle starting `@new-to-venmo` → `UNCLAIMED`; `@onhold`, `@blocked`,
`@failed` → those states; everything else → `SUCCESS`. `POST /__fake/claim/{payoutItemId}` flips an `UNCLAIMED`
item to `SUCCESS` and fires `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`. The full control plane is in the
[fake's README](../tools/fake-paypal/README.md).
