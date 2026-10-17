# Pre-submit checklist

Deadline: **Nov 12, 2026, 12:00 PT**. Target: submitted by **Nov 11**. Owner: whoever presses Submit. Work top to
bottom; every box is either checked or has a written reason next to it. Field text lives in
[DEVPOST_FIELDS.md](DEVPOST_FIELDS.md); upload settings in [YOUTUBE.md](YOUTUBE.md); repo settings in
[GITHUB.md](GITHUB.md).

## A. Rules compliance (a miss here disqualifies)

Quoted from the [official rules](https://paypalaihackathon.devpost.com/rules) (fetched Oct 17, 2026).

- [ ] **Public repo** on GitHub: `gh api repos/Aaaaarin/neighborline --jq .visibility` prints `public` (today: `private`).
- [ ] **License visible in the About section**: the repo sidebar shows "MIT license" when logged out.
- [ ] Repo contains **all source code, assets and run instructions** (README "Try it in 30 seconds" works on a fresh clone: `corepack enable && pnpm i && pnpm dev`, then `/demo`).
- [ ] No secrets in history: CI's gitleaks job green on `main`, plus `gitleaks detect --log-opts="--all"` locally.
- [ ] **Functional demo**: the hosted URL loads in a private window on a phone and on a laptop, *or* the run instructions above are in the testing instructions. "Mockups, static prototypes and non-functional demos do not qualify."
- [ ] Demo **free and unrestricted** through judging (Dec 1–15 window): no login, no paywall; Render plan does not sleep or expire (`render.yaml` uses paid Postgres for this reason).
- [ ] **Video under 3:00** (Draft 3 is 2:40.5), uploaded to **YouTube**, visibility **Public**, link opens logged out.
- [ ] Video shows the project **working on the device it was built for** (the browser stage and phones) end to end.
- [ ] Video has **no third-party trademarks** (no PayPal/Venmo logos or SDK buttons; `/donate` never appears) and **no copyrighted music** (silence, or a YouTube Audio Library track with its license screenshot saved).
- [ ] **English**: all submission text in English; non-English UI in the video is subtitled (burned captions + SRT).
- [ ] **AI tools named and explained**: DEVPOST_FIELDS §9b pasted.
- [ ] **PayPal integration central and on the free sandbox**: §9c pasted. *(sandbox)* If the real-sandbox spike has run, the sandbox wording is switched; if not, the "look-alike of PayPal's documented shapes" wording is kept. Never claim a real sandbox call that didn't happen.
- [ ] Text description explains features and functionality (§4 pasted, renders correctly in Devpost's preview).
- [ ] Submitted inside the window (Oct 1 – Nov 12, 2026); all commits are inside it.
- [ ] Every team member has accepted the Devpost team invite and meets eligibility (age of majority, not an excluded country).

## B. Fill-in tokens

- [ ] `grep -rn "{HOSTED_URL}\|{VIDEO_ID}\|{SANDBOX_BUYER\|{TEAM_\|{IF A LIVE\|{AFTER THE SANDBOX\|{MUSIC" docs/submission/DEVPOST_FIELDS.md docs/submission/YOUTUBE.md` returns nothing in the text you actually pasted.
- [ ] The YouTube description's first link and the video end card point at the same hosted URL (re-render the end card with `HOSTED_URL=… node docs/submission/video/build.mjs` if it still says "Live demo link in the description").
- [ ] README: "Hosted: not deployed yet" replaced with the link; `Video:` line added.

## C. Devpost form

- [ ] Name `Neighborline`; no clash on Devpost or GitHub search.
- [ ] Tagline pasted (145 chars).
- [ ] Thumbnail = `/home/claude/video-out/submission/thumbnail-1500x1000.png` (the stopwatch reads `0:22.4` in full).
- [ ] Six gallery images uploaded in order with captions (DEVPOST_FIELDS §8). The stopwatch in image 1 matches the video (`0:22.4`).
- [ ] Built-with tags, Try-it-out links, video link, repo link.
- [ ] Testing instructions pasted (§9d); every URL in them opened once on the hosted build.
- [ ] Prizes: Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce, Most Creative; **Best Use of Render only if the demo is hosted on Render**; not AG Grid, Bryntum, Channel3 or APIMatic.
- [ ] Preview the public project page logged out: video embeds, images load, links work, Markdown renders (no raw `**`).

## D. Our own quality bar

**Evidence over simulation** (JUDGE-PANEL-2's three sinkers)
- [ ] Hosted on Render: web + approver + Postgres; first load under 3 s from a cold browser; `scripts/verify-deploy.sh` passes.
- [ ] One real PayPal sandbox payout, with a verified webhook, if credentials arrive; its batch id quoted in §9c.
- [ ] A live-model run of `pnpm --filter @neighborline/agents eval --mode live` committed to EVAL.md, if a key arrives; otherwise §9b's "Honest status" paragraph stays.

**Consistency** (a careful judge cross-checks)
- [ ] Test counts in README, DEVPOST_FIELDS, the video's code card and badges equal a fresh `pnpm test` (972 on Oct 17) and `playwright test --list` (34). CI green on `main`.
- [ ] The stopwatch value (`0:22.4`), the split (`0:19.2` / `0:03.1`) and "about 22 s / about 3 s" agree across video, thumbnail, gallery and text.
- [ ] Every "not built / not live" statement is still true: phone line built but no number; SMS/WhatsApp not built; hosted or not; sandbox run or not.
- [ ] `/trust` "Sandbox reality" matches README "Sandbox reality" and §9c.

**Video**
- [ ] The uploaded file is the **voiced** cut, watched once at 1.5× and once muted; captions carry the story muted.
- [ ] Synthetic-voice disclosure: corner tag on screen, description, and YouTube's "Altered or synthetic content" = Yes.
- [ ] Custom thumbnail set; chapters appear under the player.
- [ ] Vietnamese and Spanish audio and on-screen text checked by a native speaker (review packet rows marked "In video").

**Language and respect**
- [ ] Native-speaker review returned for at least vi, es and ht ([review/REVIEWER_GUIDE.md](review/REVIEWER_GUIDE.md)); fixes applied; `node docs/submission/review/extract.mjs --check` passes.
- [ ] The English twin under "approved, sending" says the same thing as the Vietnamese and Spanish (known mismatch, `engine.ts` `afterSent`).
- [ ] Spanish texts don't assume a woman ("la llamemos para ayudarla", "una organizadora").

**Repo first screen**
- [ ] Description, website, 20 topics and the social preview set (GITHUB.md).
- [ ] README hero GIF (`docs/media/stage.gif`, 1.9 MB) plays on github.com; badges green.
- [ ] Gallery JPEGs in `docs/media/gallery/` match the uploaded PNGs.

**Last hour**
- [ ] Submit, then open the public Devpost page logged out on a phone.
- [ ] Hosted demo smoke test again after submitting, and once a day through judging (Render dashboard alerts on).
- [ ] Freeze `main` (or tag `submission-2026-11-11`) so judges see what the video shows.
