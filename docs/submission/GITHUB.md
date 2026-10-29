# GitHub repo presentation

Judges open the repo from Devpost. In five seconds they should see what it is, that it's MIT, that CI is green and
where the live demo is. The rules also require the repo to be **public** with the license **visible in the About
section** (GitHub shows "MIT license" there automatically once `LICENSE` is detected, which it is).

Today (Oct 17, `gh api repos/Aaaaarin/neighborline`): **private**, no description, no website, no topics.

## About → Description (≤ 350 characters)

```
A mutual-aid hotline: a neighbor leaves a voice note in any language, AI reads it back, code applies the group's rules, two organizers approve with passkeys, and PayPal Payouts sends cash to PayPal or Venmo. Includes neighborline-payouts-mcp: AI agents can pay only with two humans' signatures.
```

294 characters.

## About → Website

```
https://neighborline.onrender.com/demo
```

Until it is hosted, leave it empty (don't point it at localhost or Devpost).

## About → Topics (20)

```
paypal  paypal-payouts  venmo  mutual-aid  disaster-relief  ai-agents  mcp  model-context-protocol  llm  claude  openai  structured-outputs  speech-to-text  multilingual  passkeys  webauthn  nextjs  typescript  accessibility  hackathon
```

Tick **Releases**, **Packages** off and **Deployments** on in the About panel's checkboxes if the Render deploy
reports to GitHub; otherwise untick it too.

## Social preview (Settings → General → Social preview)

Upload `/home/claude/video-out/submission/social-preview.png` (1280×640 PNG, under GitHub's 1 MB limit). A small copy
for reference is in [docs/media/social-preview.jpg](../media/social-preview.jpg). It shows Mrs. Lan's phone at the paid
moment and the line "Leave a voice note in any language. Two neighbors approve. Cash lands in PayPal or Venmo." This
is the card Slack, X and LinkedIn show when someone pastes the repo link. There is no API for it; it has to be uploaded
in the web UI.

## Commands (owner, after approving the repo going public)

```bash
# 1. Check history for secrets one last time (CI runs gitleaks on every push; this is the belt to its braces)
gitleaks detect --source . --log-opts="--all" --redact

# 2. Go public
gh repo edit Aaaaarin/neighborline --visibility public --accept-visibility-change-consequences

# 3. About panel
gh repo edit Aaaaarin/neighborline \
  --description "A mutual-aid hotline: a neighbor leaves a voice note in any language, AI reads it back, code applies the group's rules, two organizers approve with passkeys, and PayPal Payouts sends cash to PayPal or Venmo. Includes neighborline-payouts-mcp: AI agents can pay only with two humans' signatures." \
  --homepage "https://neighborline.onrender.com/demo" \
  --add-topic paypal,paypal-payouts,venmo,mutual-aid,disaster-relief,ai-agents,mcp,model-context-protocol,llm,claude \
  --add-topic openai,structured-outputs,speech-to-text,multilingual,passkeys,webauthn,nextjs,typescript,accessibility,hackathon \
  --enable-issues --enable-discussions=false --enable-wiki=false

# 4. Verify what a logged-out judge sees
gh api repos/Aaaaarin/neighborline --jq '{visibility, description, homepage, license: .license.spdx_id, topics}'
```

## README check (what the first screen shows)

- The hero GIF ([docs/media/stage.gif](../media/stage.gif): the recorded Lan run at 3×, 960 px, 1.9 MB, labelled
  "3× speed · simulated PayPal sandbox · fictional people"), linking to the full-size PNG.
- The badges: CI, MIT, tests. Make sure the CI badge is green on `main` before submitting; a red badge on the first
  screen costs more than any feature.
- "Try it in 30 seconds" still says **Hosted: not deployed yet**. Replace that line with the hosted link the moment it
  exists, and add `**Video:** https://youtu.be/{VIDEO_ID}` under it.
- Pin the repo on the owner's profile; add the Devpost link to the README's "Built for" line once the project page is
  live.
