# Neighborline — design direction

> A hotline, not a dashboard. The neighbor's phone is the main character.

## The idea: "a porch light in an ice storm"

Eastside, the morning after an ice storm. Power is out, phones are on 23 %, the light is cold and
blue-grey. Everything in Neighborline lives in that cool, quiet light — frost-white paper and
blue-black ballpoint ink — **and the only warm colour in the whole product is the moment money
arrives.** Amber is the colour of a porch light coming back on, a heater coil, a lit window in a
blackout. We never spend it on decoration, buttons or branding. When a screen turns warm, a
neighbor just got paid.

That gives us one memorable thing (the warm arrival + a stopwatch that freezes on it) and lets
everything else stay calm, disciplined and readable.

What we deliberately avoid: fintech dashboards (KPI tiles with gradients, dense data grids above the
fold), cream-paper + terracotta, the SaaS card kit (one radius + one grey shadow on everything),
all-caps eyebrow labels, and middle-dot meta strings as decoration.

## Colour tokens

All pairs below were measured (WCAG 2.x relative luminance). Body text ≥ 7:1, secondary ≥ 4.5:1.

| Token | Light ("morning") | Dark ("blackout night") | Role |
|---|---|---|---|
| `--paper` | `#EFF1EE` | `#141A24` | Page background — cool frost white / night |
| `--paper-raised` | `#F9FAF8` | `#1C2330` | Cards, phone screens, sheets |
| `--sunk` | `#E3E7E5` | `#0F141C` | Wells, table stripes, inactive tracks |
| `--rule` | `#CDD3D1` | `#2E3746` | Hairlines, borders |
| `--ink` | `#18202E` | `#ECEEE8` | Primary text (14.4:1 / 14.9:1) — blue-black ballpoint |
| `--ink-2` | `#444D5C` | `#B9C0CA` | Secondary text (7.5:1 / 9.5:1) |
| `--ink-3` | `#5F6877` | `#8D96A3` | Tertiary text, timestamps (4.95:1 / 5.8:1) |
| `--frost` | `#D6E2EA` | `#22344A` | The neighbor's own bubbles, cool info surfaces |
| `--frost-ink` | `#27445E` | `#B7CDE0` | Text on frost (7.7:1 / 7.7:1) |
| `--lamp` | `#F4B33D` | `#F6BC4F` | **Money arrived.** Fill only; ink text on it (8.8:1) |
| `--lamp-ink` | `#7A4700` | `#F8C76A` | Warm text on paper (6.8:1) |
| `--lamp-wash` | `#FBEBC4` | `#3A2C12` | The glow a phone screen turns when paid |
| `--lamp-display` | `#B06A00` | `#F6BC4F` | Only for the frozen stopwatch digits (≥ 72px; 3.7:1 — large-text AA) |
| `--pine` | `#2D6A4F` | `#7CC3A0` | Checks passed, verified (5.6:1 / 8.5:1) |
| `--pine-wash` | `#D9EBE0` | `#17322A` | Passed-check chip fill |
| `--signal` | `#B3261E` | `#FF8A7E` | Blocked by rail protection (5.8:1 / 7.6:1) |
| `--signal-wash` | `#F6DDD9` | `#3D1C1A` | Blocked chip fill |
| `--device` | `#1B2230` | `#0B0F16` | Phone bodies |

Rules:
- **Amber = money landed.** Pending money is ink. Approved-but-not-paid is ink. Only `SUCCESS`
  (and the donor's own completed gift) turns warm.
- **Pine and signal are status colours** and always ship with an icon and words ("Handle checked",
  "Lookalike handle blocked") — never colour alone.
- Primary actions are solid ink (`--ink` fill, `--paper-raised` text): calm, unmistakable, not
  "brand blue".
- Dark mode is a *selected* palette (a blackout night), not an inversion: `prefers-color-scheme`
  plus `:root[data-theme="dark"|"light"]` overrides.

Chart palette (validated with the dataviz validator against `--paper-raised`): single series
`#2F6EA8` light / `#4A8BCB` dark; reference lines in `--ink-3`. Charts are single-series by design.

## Typography

Fonts are Google Fonts families, **self-hosted via Fontsource** (`@fontsource*` CSS imported in
`app/layout.tsx`, split by `unicode-range` so only the Latin/Vietnamese subsets a page uses download).
We chose this over `next/font/google` because the build must not depend on fonts.googleapis.com (it is
blocked in our build sandbox and judges may run offline); switching back is a one-file change in
`app/layout.tsx`.

| Role | Family | Why |
|---|---|---|
| Display + narrative | **Literata** (variable, optical size) | A reading serif built for screens. Low contrast, sturdy, warm at large sizes — a letter from a neighbor, not a luxury magazine. Full Vietnamese support. |
| UI + body | **Be Vietnam Pro** (400/500/600/700) | Designed by Vietnamese type designers for correct stacked diacritics (ố, ữ, ặ) — Mrs. Lan's language renders perfectly, and it's crisp in tables. |
| Identifiers only | **Atkinson Hyperlegible Mono** | From the Braille Institute; unambiguous 0/O, 1/l/I. Used *only* for PayPal batch ids, transaction ids and handles that people may read aloud or compare. Never for labels. |

Scale (major third, 1.25, base 17px): 13.6 · 17 · 21 · 26.5 · 33 · 41.5 · 52 · 65 · 81 px.
- Body 17/1.6 (Be Vietnam Pro), serif narrative 19/1.7 (Literata), max measure 68ch.
- Headings in Literata 500–600, sentence case, letter-spacing −0.01em at ≥33px.
- Numbers in tables and the running stopwatch use `tabular-nums`; standalone figures are proportional.
- No all-caps labels. Small labels are sentence case at 13.6px in `--ink-3`.

## Space, shape, depth

- 4px base grid; rhythm steps 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 112.
- Radius encodes hierarchy, not decoration: phone body 52px, phone screen 40px, chat bubbles 20px
  (with one 6px "tail" corner), sheets/cards 16px, chips full-pill, inputs 12px.
- Depth: paper doesn't float. Cards sit on hairlines (`--rule`). Only phones cast a shadow (they
  are physical objects on a desk): a long, soft, blue-tinted shadow.
- Layout is left-aligned throughout. Centre alignment only inside phone UIs where the OS would.

## Motion

- One orchestrated moment: **money arrives** — Lan's screen warms from frost to `--lamp-wash`
  over 1.2 s, the paid bubble lands, the stopwatch freezes and its digits turn `--lamp-ink`.
- Everything else answers an action: new timeline rows and chat bubbles enter with a 180 ms
  8px rise; approve buttons compress on press (scale .98) and resolve to a check; organizer phones
  give a 2-step 300 ms "buzz" when a request arrives.
- Easing `cubic-bezier(.2,.7,.2,1)` (out), durations 120 / 180 / 320 / 1200 ms.
- `prefers-reduced-motion: reduce` removes translation, buzz and glow transitions (colour still changes
  instantly so the state is never lost).

## Iconography

Lucide, 1.75px stroke, 20px default (24px in phone UIs), always paired with a text label or an
`aria-label`. Custom marks: the Neighborline wordmark (a short horizontal "line" with a lit dot —
a phone line ending in a porch light) and the voice-note waveform (deterministic bars).

## Voice & tone

- Plain, warm, short. Say what happens, not how the system is built. "Two neighbors approve" — not
  "multi-signature authorization".
- Requesters are **neighbors**, never "users", "applicants" or "beneficiaries".
- Requester copy is written natively in Vietnamese, Spanish and Haitian Creole (not translated
  word-for-word), polite register (cô / usted / ou).
- Organizer copy is factual and cites the rule: "Policy v1 · Utility outage · up to $150".
- Buttons name the outcome: "Approve $150", "Decline and tell Lan why", "Give $50".
- Errors give direction, never apologise vaguely: "This handle is one letter away from the group's
  own account, so we won't send to it. Ask the neighbor to confirm their Venmo."
- Honest about sandbox everywhere: a "simulated" tag wherever a real PayPal call is replaced.

## Accessibility targets (WCAG 2.2 AA)

- Contrast ≥ 4.5:1 for all text, ≥ 3:1 for UI boundaries and chart marks (table above).
- Every interactive target ≥ 44×44px (record button 120px; approve button 56px tall).
- Visible focus: 3px `--ink` outline with 2px paper offset (amber is never used for focus).
- All live state changes are announced: the stage timeline and requester thread are `aria-live="polite"`;
  "money arrived" is announced once.
- Hold-to-record also works as press-to-toggle with keyboard (Space/Enter) and with screen readers.
- Charts have a table twin (`<details>`), text never wears the series colour.
- Language is set per element (`lang="vi"`, `lang="es"`, `lang="ht"`) so screen readers switch voices.

## Page map

| Page | Layout concept |
|---|---|
| `/` | Left-aligned promise in Literata, Lan's phone beside it, the 90-second story as a real timeline. |
| `/demo` | Four columns from 1680px (`stage:` breakpoint): Lan's phone · Dana + Marcus · stopwatch + PayPal rail. 1024–1679: phones row, rail below. Under 1024: tabs (Neighbor / Organizers / Rail) with a mini stopwatch. |
| `/call` | One phone-width column. Big record button, read-back, status thread. |
| `/organizer` | One phone-width column queue of approve cards; decline sheet. |
| `/donate` | Two columns: gift form + Smart Buttons / how your money moves (a real sequence). |
| `/report` | Long-read: narrative first, then figures and four single-series charts with table twins. |
| `/trust` | Checklist, Know-Your-Agent diagram, principles, privacy, sandbox reality. |
| `/ledger` | Organizer table, status chips, reconcile badge. The one dense page, and it's not in the video. |
