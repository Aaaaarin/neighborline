// Renders every card and overlay from HTML with the product's own fonts (Fontsource files) and DESIGN.md tokens.
// Opaque cards are 1920×1080; overlays are 1920×1080 transparent PNGs positioned where they will sit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHROME_ARGS, DIRS, REPO, playwright, resolveWeb } from './common.mjs';

const fontCss = ['@fontsource-variable/literata/index.css', '@fontsource/be-vietnam-pro/400.css', '@fontsource/be-vietnam-pro/500.css', '@fontsource/be-vietnam-pro/600.css', '@fontsource-variable/atkinson-hyperlegible-mono/index.css']
  .map((p) => `<link rel="stylesheet" href="${pathToFileURL(resolveWeb(p)).href}">`)
  .join('');

export const TOKENS = `:root{--paper:#EFF1EE;--raised:#F9FAF8;--sunk:#E3E7E5;--rule:#CDD3D1;--ink:#18202E;--ink-2:#444D5C;--ink-3:#5F6877;--frost:#D6E2EA;--frost-ink:#27445E;--lamp:#F4B33D;--lamp-ink:#7A4700;--lamp-wash:#FBEBC4;--lamp-display:#B06A00;--pine:#2D6A4F;--pine-wash:#D9EBE0;--signal:#B3261E;--signal-wash:#F6DDD9}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden}
body{background:var(--paper);color:var(--ink);font-family:'Be Vietnam Pro',sans-serif;-webkit-font-smoothing:antialiased}
body.t{background:transparent}
.serif{font-family:'Literata Variable',Literata,serif}
.mono{font-family:'Atkinson Hyperlegible Mono Variable','Atkinson Hyperlegible Mono',monospace}
.sheet{position:absolute;background:var(--raised);border:1px solid var(--rule);border-radius:16px;padding:18px 26px}
.sheet .t1{font-size:26px;font-weight:600;line-height:1.3}
.sheet .t2{font-size:20px;color:var(--ink-2);margin-top:4px;line-height:1.35}
.sheet .t2.mono{font-size:21px;color:var(--frost-ink)}
.pill{position:absolute;background:var(--raised);border:1px solid var(--rule);border-radius:999px;padding:7px 16px;font-size:17px;color:var(--ink-3);white-space:nowrap}`;

export const wordmark = (lit, size = 1) => `<span style="display:inline-flex;align-items:center;gap:${12 * size}px">
<svg width="${42 * size}" height="${20 * size}" viewBox="0 0 30 14"><path d="M1 7h17" stroke="#18202E" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="7" r="4.5" fill="${lit ? '#F4B33D' : 'none'}" stroke="${lit ? '#F4B33D' : '#18202E'}" stroke-width="2"/></svg>
<span class="serif" style="font-size:${34 * size}px;font-weight:620;letter-spacing:-0.015em">Neighborline</span></span>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Opens one browser for a batch of renders. */
export async function withRenderer(fn) {
  const { chromium } = await playwright();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const render = async (name, body, { transparent = false, css = '', w = 1920, h = 1080, dir = DIRS.cards } = {}) => {
    await page.setViewportSize({ width: w, height: h });
    // Written to a file and opened by file:// URL: an about:blank page may not load file:// font stylesheets.
    const html = join(DIRS.cards, `_${name}.html`);
    writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8">${fontCss}<style>${TOKENS}html,body{width:${w}px;height:${h}px}${css}</style></head><body class="${transparent ? 't' : ''}">${body}</body></html>`);
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const used = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    if (!used.some((f) => /Be Vietnam Pro/.test(f))) throw new Error(`card ${name}: Be Vietnam Pro did not load`);
    // Nothing may run off the frame or into the caption band.
    const overflow = await page.evaluate((limit) => {
      const bad = [...document.querySelectorAll('.wrap, .ln .code')].filter((el) => el.getBoundingClientRect().bottom > limit || el.scrollWidth > el.clientWidth + 1);
      return bad.map((el) => el.className + ': ' + el.textContent.slice(0, 60));
    }, h - 150);
    if (overflow.length) throw new Error(`card ${name} overflows: ${overflow.join(' | ')}`);
    await page.waitForTimeout(60);
    const out = join(dir, `${name}.png`);
    await page.screenshot({ path: out, omitBackground: transparent });
    return out;
  };
  try {
    return await fn(render, page);
  } finally {
    await browser.close();
  }
}

// ---------- code excerpts ----------

const KW = /\b(export|function|const|let|return|if|else|async|await|new|throw|for|of|typeof|class|private|readonly|interface|type|import|from|switch|case|try|catch)\b/g;
function highlightTs(line) {
  // Restrained, on-brand: comments ink-3, strings frost-ink, keywords semibold. No rainbow.
  const out = [];
  let i = 0;
  const push = (cls, s) => out.push(cls ? `<span class="${cls}">${esc(s)}</span>` : esc(s).replace(KW, '<b>$1</b>'));
  while (i < line.length) {
    const rest = line.slice(i);
    const cm = /^(\/\/.*|\/\*.*|^\s*\*.*)/.exec(rest);
    if (cm && (rest.startsWith('//') || rest.startsWith('/*') || (i === 0 && /^\s*\*/.test(rest)))) {
      push('c', rest);
      break;
    }
    const st = /^(['"`])(?:\\.|(?!\1).)*\1/.exec(rest);
    if (st) {
      push('s', st[0]);
      i += st[0].length;
      continue;
    }
    const plain = /^[^'"`/]+|^\//.exec(rest)[0];
    push('', plain);
    i += plain.length;
  }
  return out.join('');
}

/** Finds the 1-based line of the first match, or throws (the cards must match the committed code). */
function lineOf(lines, re, file) {
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) throw new Error(`code card: ${re} not found in ${file}; update CODE_CARDS in lib/cards.mjs`);
  return i + 1;
}

export const CODE_CARDS = [
  {
    id: 'code-1',
    title: 'Every AI output: schema-checked, repaired once, or the neighbor is asked again',
    file: 'packages/agents/src/validate.ts',
    excerpts: [
      { from: /^\/\*\*/, to: /^ \*\/$/ },
      { from: /^export function summarizeTrace/, count: 9 },
    ],
    highlight: [/invalid\? → ONE repair call/, /Schema repaired \$\{/],
  },
  {
    id: 'code-2',
    title: 'The batch ID is a hash of the signed approval, so a double tap can’t pay twice',
    file: 'packages/core/src/approvals.ts',
    excerpts: [
      { from: /The approval-service gate/, count: 8 },
      { from: /PayPal sender_batch_id: deterministic/, count: 5 },
    ],
    highlight: [/distinctApprovers\(approval\.approvers\) >=/, /return `nl_\$\{approval\.hash\.slice\(0, 24\)\}`/],
  },
  {
    id: 'code-3',
    title: 'Webhooks are verified by PayPal, with the raw body spliced in byte for byte',
    file: 'packages/paypal/src/webhooks.ts',
    excerpts: [
      { from: /^\/\*\*/, to: /^ \*\/$/ },
      { from: /const head = JSON\.stringify\(h\)/, count: 2 },
      { from: /async verifyWebhookSignature/, count: 7 },
    ],
    highlight: [/"webhook_event":\$\{input\.rawBody\.trim\(\)\}/, /path: '\/v1\/notifications\/verify-webhook-signature'/],
  },
];

function excerptHtml(card) {
  const src = readFileSync(join(REPO, card.file), 'utf8').split('\n');
  const blocks = [];
  let first = Infinity;
  let last = 0;
  for (const ex of card.excerpts) {
    const a = lineOf(src, ex.from, card.file);
    const b = ex.to ? a - 1 + lineOf(src.slice(a - 1), ex.to, card.file) : Math.min(src.length, a + ex.count - 1);
    first = Math.min(first, a);
    last = Math.max(last, b);
    blocks.push(
      src
        .slice(a - 1, b)
        .map((l, k) => {
          const n = a + k;
          const hl = card.highlight.some((re) => re.test(l));
          return `<div class="ln${hl ? ' hl' : ''}"><span class="no">${n}</span><span class="code">${highlightTs(l) || ' '}</span></div>`;
        })
        .join(''),
    );
  }
  for (const re of card.highlight) if (!src.some((l) => re.test(l))) throw new Error(`code card ${card.id}: highlight ${re} not found in ${card.file}`);
  return { html: blocks.join('<div class="gap">⋯</div>'), range: `${first}–${last}` };
}

const CODE_CSS = `.wrap{position:absolute;left:150px;top:92px;width:1620px}
h2{font-family:'Literata Variable',serif;font-weight:560;font-size:40px;letter-spacing:-0.01em;line-height:1.2;margin-bottom:22px;max-width:1500px}
.card{background:var(--raised);border:1px solid var(--rule);border-radius:16px;overflow:hidden}
.hdr{padding:14px 26px;border-bottom:1px solid var(--rule);font-size:19px;color:var(--ink-3)}
.hdr .mono{color:var(--ink-2)}
.body{padding:14px 0 18px}
.ln{display:flex;font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:21px;line-height:1.42;white-space:pre-wrap;padding:0 26px}
.code{flex:1;min-width:0;overflow-wrap:anywhere}
.ln.hl{background:var(--frost)}
.no{width:56px;flex:none;color:var(--ink-3);opacity:.75;text-align:right;margin-right:22px}
.code b{font-weight:700}.code .c{color:var(--ink-3)}.code .s{color:var(--frost-ink);font-weight:600}
.ln.hl .code{color:var(--ink)}
.gap{font-family:'Atkinson Hyperlegible Mono Variable',monospace;color:var(--ink-3);padding:2px 26px 2px 104px;font-size:20px}
.term .ln{padding:0 26px}.term .ok{color:var(--pine);font-weight:700}
.foot{margin-top:18px;font-size:21px;color:var(--ink-2)}`;

/** Lines of the real `pnpm -r test` run (cached in OUT/cache), never typed by hand. */
export function testSummary(logPath) {
  const raw = readFileSync(logPath, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  const rows = [];
  let pkg = null;
  let failed = /EXIT [1-9]/.test(raw);
  for (const l of raw.split('\n')) {
    const m = /^(packages|apps|tools)\/([\w-]+) test/.exec(l.trim());
    if (m) pkg = `${m[1]}/${m[2]}`;
    const t = /Tests\s+.*?(\d+) passed/.exec(l);
    const f = /Test Files\s+.*?(\d+) passed/.exec(l);
    if (/(Tests|Test Files)\s+.*\d+ failed/.test(l)) failed = true;
    if (f && pkg) rows.push({ pkg, files: f[1] });
    if (t && pkg && rows.at(-1)?.pkg === pkg) rows.at(-1).tests = `${t[1]} passed`;
  }
  if (!rows.length) throw new Error(`no vitest summaries in ${logPath}`);
  return { rows, failed };
}

export async function renderCodeCards(render, testLog) {
  for (const card of CODE_CARDS) {
    const { html, range } = excerptHtml(card);
    await render(card.id, `<div class="wrap"><h2>${esc(card.title)}</h2><div class="card"><div class="hdr"><span class="mono">${card.file}</span> · lines ${range}</div><div class="body">${html}</div></div></div>`, { css: CODE_CSS });
  }
  // Card 4: the real test run + reconcile's signature.
  const { rows, failed } = testSummary(testLog);
  const rec = readFileSync(join(REPO, 'packages/paypal/src/reconcile.ts'), 'utf8').split('\n');
  const n = lineOf(rec, /^export function reconcile\(/, 'reconcile.ts');
  const total = rows.reduce((a, r) => a + Number(/^(\d+)/.exec(r.tests ?? '0')[1]), 0);
  const term = rows
    .map((r) => `<div class="ln"><span class="code"><span class="ok">✓</span> ${esc(r.pkg.padEnd(22))} ${esc(`${r.tests ?? ''} tests`.padEnd(18))}<span class="c">${esc(r.files)} file${r.files === '1' ? '' : 's'}</span></span></div>`)
    .join('');
  const sig = rec[n - 1].replace(/: ReconcileReport \{$/, ': ReconcileReport');
  await render(
    'code-4',
    `<div class="wrap" style="top:80px"><h2>${failed ? 'Tests (some failing!)' : `${total} tests pass`}, and every payout is reconciled against PayPal Transaction Search</h2>
<div class="card term"><div class="hdr"><span class="mono">$ pnpm -r test</span> · summary per package</div><div class="body">${term}</div></div>
<div class="card" style="margin-top:16px"><div class="hdr"><span class="mono">packages/paypal/src/reconcile.ts</span> · line ${n}</div><div class="body"><div class="ln hl" style="white-space:pre-wrap"><span class="no">${n}</span><span class="code">${highlightTs(sig)}</span></div></div></div>
<p class="foot"><b style="color:var(--ink)">Open source · MIT</b> · @neighborline/paypal + an MCP server that adds Payouts tools to the PayPal Agent Toolkit</p></div>`,
    { css: CODE_CSS },
  );
  return { rows, total, failed };
}

// ---------- title, end card, overlays ----------

export async function renderTitle(render) {
  await render(
    'title',
    `<div style="position:absolute;left:190px;top:200px;width:1500px">
${wordmark(false, 1.1)}
<h1 class="serif" style="font-size:72px;font-weight:600;letter-spacing:-0.015em;margin-top:46px;line-height:1.1">A hotline, not a dashboard.</h1>
<div style="margin-top:64px;display:grid;gap:34px;max-width:1300px">
 <div><p style="font-size:32px;line-height:1.35">300 relief requests overnight, in Instagram comments.</p>
 <p style="font-size:17px;color:var(--ink-3);margin-top:8px">LA Public Press, Jan 2025 · Mutual Aid LA Network after the Eaton fire</p></div>
 <div><p style="font-size:32px;line-height:1.35">Fake Venmo handles, one letter off the real group’s.</p>
 <p style="font-size:17px;color:var(--ink-3);margin-top:8px">Chronicle of Philanthropy, Apr 2026</p></div>
</div></div>`,
  );
}

/** Right-hand end card (transparent), composited over composition A's stopwatch area. */
export async function renderEnd(render, { hostedUrl, repo, event }) {
  for (const lit of [false, true]) {
    const placeholder = /\{HOSTED_URL\}/.test(hostedUrl);
    const url = placeholder ? `<span style="background:var(--signal-wash);color:var(--signal);padding:0 8px;border-radius:6px">HOSTED_URL</span>/demo` : esc(hostedUrl);
    await render(
      lit ? 'end-lit' : 'end',
      `<div style="position:absolute;left:790px;top:110px;width:1060px;height:820px;background:var(--paper);padding:60px 10px 0 30px">
${wordmark(lit, 1.6)}
<div style="margin-top:56px;display:grid;gap:30px;font-size:30px;line-height:1.35">
<p><span style="color:var(--ink-3);font-size:22px;display:block">Try the hotline, no login</span><span class="mono" style="font-size:32px">${url}</span></p>
<p><span style="color:var(--ink-3);font-size:22px;display:block">Open source (MIT)</span><span class="mono" style="font-size:32px">${esc(repo)}</span></p>
<p style="font-size:24px;color:var(--ink-2)">${esc(event)}</p>
</div></div>`,
      { transparent: true },
    );
  }
}

export async function renderCorner(render, text) {
  await render('corner', `<div class="pill" style="left:24px;top:20px">${esc(text)}</div>`, { transparent: true });
}

export async function renderPill(render, id, text) {
  await render(id, `<div class="pill" style="right:28px;top:20px;color:var(--ink-2);font-weight:500">${esc(text)}</div>`, { transparent: true });
}

/** A lower third at a box from the layout (x, y, w). */
export async function renderLowerThird(render, id, { title, sub, mono }, box) {
  await render(
    id,
    `<div class="sheet" style="left:${box.x}px;${box.bottom != null ? `bottom:${box.bottom}px` : `top:${box.y}px`};max-width:${box.w}px">
<div class="t1">${esc(title)}</div>${sub ? `<div class="t2${mono ? ' mono' : ''}">${esc(sub)}</div>` : ''}</div>`,
    { transparent: true },
  );
}

export async function renderHandles(render, box) {
  await render(
    'ov-handles',
    `<div class="sheet mono" style="left:${box.x}px;top:${box.y}px;padding:22px 28px;font-size:38px;line-height:1.45">
<div>@eastside-mutua<b style="font-weight:700">l</b>aid <span style="font-family:'Be Vietnam Pro';font-size:22px;color:var(--ink-3)">← the group</span></div>
<div style="color:var(--signal)">@eastside-mutua<b style="font-weight:700;background:var(--signal-wash)">i</b>aid <span style="font-family:'Be Vietnam Pro';font-size:22px;color:var(--signal)">← the text message</span></div></div>`,
    { transparent: true },
  );
}

export function writeHtmlForReview(name, html) {
  writeFileSync(join(DIRS.cards, `${name}.html`), html);
}
