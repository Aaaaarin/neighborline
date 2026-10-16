# Thumbnail, first frame and gallery brief

**The job of the thumbnail.** In a gallery of about 1,000 cards, ours must say "a person, her phone, money arrived,
fast" at 300 px wide, in under a second. It must not look like a dashboard: most other cards are dark UIs and
PayPal-blue buttons.

## 1. Thumbnail concept: "the porch light comes on"

**Copy (3 words):** **Voice note → cash**

The only other text on the image is the stopwatch's frozen time, `0:{T}`. `{T}` is the real value from the
recorded `speed=1` take (about 0:29). It must match the video and the gallery image exactly.

**Composition (Devpost 3:2 at 1500×1000; YouTube 16:9 at 1280×720 uses the same layout, re-flowed):**

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌───────────┐      Voice note                              │
│   │  phone    │      → cash                (Literata 600,    │
│   │  (warm,   │                             ink #18202E,      │
│   │   amber   │      0:29                   ~13% of height)   │
│   │   wash)   │      (stopwatch digits, amber #B06A00,        │
│   │  "$150"   │       ~30% of image height, light weight,     │
│   │  "Tiền đã │       tabular)                                │
│   │   đến"    │                                               │
│   └───────────┘                                              │
│  frost paper #EFF1EE, a faint cool vignette at the corners    │
└──────────────────────────────────────────────────────────────┘
```

- **Left 40 %: Mrs. Lan's phone in its paid state.** Crop it from the frozen frame of the recorded take (2× source), not a mock-up, so it is the real product. The `--lamp-wash` amber screen is the only warm surface. The `$150` bubble and "Tiền đã đến" (the money has arrived) must be legible at 1500 px. At 300 px only "$150" needs to read. Tilt the phone 0° (no fake 3D). Keep the soft, long, blue-tinted phone shadow from DESIGN.md.
- **Right 60 %: the words and the clock.** "Voice note / → cash" on two lines, top-aligned with the phone's top edge. The frozen stopwatch sits below in `--lamp-display` amber. This is the second and last warm element.
- **Background:** `--paper` frost white. Optional: a very faint ice-crystal texture at ≤ 4 % opacity in the top corners, to hint at the ice storm without stock imagery.
- **No logos and no brand names** in the thumbnail. "PayPal" and "Venmo" do not appear except as tiny product text inside the phone, which is unreadable at gallery size. No PayPal blue anywhere.
- **No faces.** All the people are fictional, and a stock "grandmother" photo would undercut the "real product" feel. The Vietnamese text on her phone carries the human signal.
- **Dark-mode variant (optional A/B for YouTube):** the "blackout night" palette, a navy `#141A24` background with the amber phone glowing. It is more dramatic and reads well on YouTube's dark UI. Keep the 3:2 Devpost card light, so it stands apart from the many dark-dashboard cards.

**Legibility test.** Downscale to 300×200 and 168×94 (the YouTube sidebar size) and check (the Read tool works for
this):
- [ ] "Voice note → cash" is readable at 300 px.
- [ ] The stopwatch reads as a stopwatch at 168 px.
- [ ] The phone reads as a phone.
- [ ] Nothing on the card says "dashboard".

**How to produce it (agent):** `cards.mjs` (RECORDING_PLAN.md step 4) composes an HTML page from:
- `stills/lan-paid-phone.png`, cropped from `takes/lan.webm` at the frozen frame with crop box `816:1736:48:184`
- the Literata and Be Vietnam Pro fonts
- the stopwatch digits, rendered as text with the app's own stopwatch styles

It screenshots two files, `thumbnail-1500x1000.png` and `thumbnail-1280x720.png`. YouTube's limit is 2 MB, so use
PNG-8 or high-quality JPEG if needed.

## 2. The video's first frame

The video opens on the **same composition in its "before" state**: her phone in cool frost light, showing "Mrs.
Lan's power has been out for two days", and the stopwatch at `0:00.0` in ink. The thumbnail is the "after". Someone
who clicks the warm card sees the cold version of the same picture and knows exactly what they are waiting for. That
is the whole story in two frames.

## 3. Gallery images (5, in upload order)

Export every gallery image at **1500×1000 (3:2)**: the screenshot sits on `--paper` with a 64 px margin and a one-line
caption strip in Be Vietnam Pro 28 px. The 16:9 screenshots then sit consistently in Devpost's 3:2 carousel, and each
one carries its message even without the caption field. Paste the same caption into Devpost's image caption.

| # | Image | Source and state | Caption |
|---|---|---|---|
| 1 | **Hero** | The thumbnail itself (1500×1000) | "A Vietnamese voice note becomes Venmo cash, approved by two neighbors. 0:{T} from voice note to PayPal SUCCESS." |
| 2 | **The whole loop** | `/demo?scenario=lan&speed=1&autoplay=1` at 1920×1080, captured after the stopwatch freezes, so the frozen time equals `{T}` and the rail shows the batch id, the verified webhook and the callback. `apps/web/screenshots/demo-1920-lan-done.png` is now taken at `speed=1` and shows the people/system split under the frozen time; re-shoot only if `{T}` differs | "One request, start to finish: read back in Vietnamese, $150 from the group's rules, two approvals, one Payouts batch, a signature-verified SUCCESS webhook." |
| 3 | **Unclaimed, then rescued** | `/demo?scenario=rosa&speed=1&autoplay=1` after SUCCESS. **Re-shoot at speed 1.** The existing `demo-1920-rosa-rescued.png` is at speed 3 | "Rosa's PayPal email had no account yet. PayPal reported UNCLAIMED; Neighborline explained how to claim it, in Spanish. Then SUCCESS." |
| 4 | **Impersonator blocked** | `apps/web/screenshots/demo-1920-blocked-done.png` (speed 1; "Lookalike handle blocked" and "Approve disabled" on both phones). Usable as is | "'@eastside-mutuaiaid' is one letter from the group's handle. Approve is disabled on every phone; no money moves." |
| 5 | **Know your agent** | `/trust` at 1920 wide, DPR 2, clipped to the "Know your agent: who can do what" section: the dashed "Cannot move money" box and the chain down to the dark approval-service card. Use `shot.mjs` with a clip, or crop `trust-1920.png` (full page, about y 950–1930 at 1×) | "The AI agents that talk to neighbors can't move money. Code computes amounts; two humans approve; webhooks are verified." |

**Alternates** (use one if a slot above looks weak once it is re-shot):
- `apps/web/screenshots/call-390-readback.png`, a phone-only view of the Spanish read-back with "Sí, correcto". Caption: "Nothing is filed until the neighbor hears it back in their language and says yes."
- `/report`, top section, with the "Every number checked against the ledger" chip. It **must** carry "Seeded demo data" in the caption, because the figures are fixtures.
- `demo-1920-lan-paid-dark.png`, re-shot at speed 1: the "blackout night" palette.

**Never in the gallery:**
- `/donate`: the PayPal SDK buttons render official PayPal and Venmo marks.
- `/ledger`: the one dense table page, which is exactly the dashboard look we are avoiding.
- Any image whose stopwatch value disagrees with the video.
