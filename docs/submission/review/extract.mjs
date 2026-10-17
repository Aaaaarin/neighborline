#!/usr/bin/env node
// Native-speaker review packet: pulls EVERY requester-facing string out of the source with the TypeScript
// compiler API (no hand-copied text), pairs it with its English source, and writes one CSV per language.
//
//   node docs/submission/review/extract.mjs            # writes docs/submission/review/<lang>.csv + strings.json
//   node docs/submission/review/extract.mjs --check    # exit 1 if the committed CSVs are stale
//
// What counts as requester-facing is the SOURCES list below (one row per file, with where the text appears and
// which screenshot shows it). Inside each file the extractor finds object literals keyed by language codes, in
// the two shapes the codebase uses:
//   A. key → language:  { en: '…', vi: '…', es: '…' }                 (templates.ts, rail-notice.ts, labels)
//   B. language → key:  { en: { paid: '…' }, vi: { paid: '…' } }      (core CATALOG, web STRINGS, phone PHRASES)
// Template literals keep their slots as {name} (`${s.amount}` → {amount}, `${w(s.wallet)}` → {wallet}).
// Vietnamese register variants sit beside a language's text under the keys `viElder` / `viPeer` (core address.ts);
// they become Vietnamese rows whose ID ends in "› elder" / "› peer", with {you} / {You} for the address form.
// Scenario fixtures (JSON) add the transcripts, read-backs and messages that the demo and the video show.
//
// The "Status" column says "machine-assisted, pending native review" for every row whose text was not in the first
// packet (baseline.json: frozen hashes of the texts reviewers were first sent). Empty means it was in that packet.
//
// Reviewers fill the last two columns ("OK?" and "Suggested fix"); see REVIEWER_GUIDE.md.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const require = createRequire(join(REPO, 'package.json'));
const ts = require('typescript');

const LANGS = ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'];
/** Vietnamese register variants (core address.ts): key → [language, label appended to the row's key]. */
const VARIANTS = { viElder: ['vi', 'elder (bà, ông, cô, chú, bác: “chúng cháu”, “ạ”)'], viPeer: ['vi', 'peer (anh, chị, em)'] };
const REVIEW_LANGS = ['vi', 'es', 'ht', 'zh', 'ar', 'ko', 'ru', 'fr', 'tl'];
const LANG_NAME = { es: 'Spanish', vi: 'Vietnamese', ht: 'Haitian Creole', zh: 'Chinese (Simplified)', ar: 'Arabic (MSA)', fr: 'French', tl: 'Tagalog', ko: 'Korean', ru: 'Russian' };
const SHOTS = 'apps/web/screenshots/';

/**
 * Requester-facing sources, in the order a neighbor meets them. `where` is the surface, `shot` the screenshot
 * that shows it (relative to the repo), `video` the cut's timecodes when the video shows it.
 */
const SOURCES = [
  { file: 'apps/web/lib/i18n.ts', exclude: ['speechTag()'], surface: 'Web line UI (/call and the stage phone)', where: 'Buttons, labels, placeholders and status steps on the neighbor’s phone', shot: `${SHOTS}call-390.png, ${SHOTS}call-390-readback.png, ${SHOTS}call-390-question.png`, video: { lineSub: { vi: '0:05–0:44', es: '0:57–1:21' }, listen: { vi: '0:06–0:14' }, translated: { vi: '0:05–0:44', es: '0:57–1:21' }, arrived: { vi: '0:27–0:44', es: '1:15–1:21' }, composer: { vi: '0:05–0:44', es: '0:57–1:21' }, yes: { vi: '0:13', es: '1:00' }, claim: { es: '1:09–1:15' } } },
  { file: 'packages/core/src/i18n.ts', surface: 'Message catalog (thread messages)', where: 'Messages the line sends into the neighbor’s thread; code fills {amount} {wallet} {name}', shot: `${SHOTS}demo-1920-lan-done.png (left phone), ${SHOTS}demo-1920-rosa-done.png`, video: { readback_intro: { vi: '0:06–0:14', es: '0:58–1:04' }, confirmed_waiting: { vi: '0:14–0:44', es: '1:00–1:08' }, approved_sending: { vi: '0:25–0:44', es: '1:04–1:09' }, paid: { vi: '0:27–0:57', es: '1:15–1:21' }, unclaimed_help: { es: '1:09–1:21' } }, videoVariant: 'viElder' },
  { file: 'packages/agents/src/intake/phrases.ts', surface: 'Read-back framing and clarifying questions', where: 'Wraps the AI summary in the read-back; the one clarifying question', shot: `${SHOTS}call-390-readback.png, ${SHOTS}call-390-question.png`, video: { payout_line: { vi: '0:06–0:14', es: '0:58–1:04' } }, videoVariant: 'viElder' },
  { file: 'apps/web/lib/server/engine/conversation.ts', surface: 'Quick answers', where: 'Tappable answers under a clarifying question (household size, category)', shot: `${SHOTS}call-390-household.png, ${SHOTS}call-390-question.png` },
  { file: 'packages/core/src/policy.ts', noGaps: true, surface: 'Category labels', where: 'Category names the neighbor taps as a quick answer or sees in the read-back (demo group policy v1; fr/tl/ko/ru come from the Quick answers rows)', shot: `${SHOTS}call-390-question.png` },
  { file: 'packages/core/src/i18n-vi.ts', enFrom: 'packages/core/src/i18n.ts', surface: 'Message catalog (thread messages)', where: 'The same messages for a Vietnamese neighbor who is addressed as an elder or a peer ({you} = bà, ông, chị…, from how they spoke)', shot: `${SHOTS}demo-1920-lan-done.png (left phone)`, video: { confirmed_waiting: { vi: '0:14–0:44' }, approved_sending: { vi: '0:25–0:44' }, paid: { vi: '0:27–0:57' }, readback_intro: { vi: '0:06–0:14' } }, videoVariant: 'viElder' },
  { file: 'apps/web/lib/server/fixtures/copy-status.ts', surface: 'Web line status messages', where: 'Acknowledgement, sending, paid with transaction id, claim help, quick answers, generic read-back and blocked reply in the neighbor’s thread', shot: `${SHOTS}call-390-readback.png, ${SHOTS}demo-1920-rosa-done.png` },
  { file: 'apps/web/lib/server/fixtures/copy-decline.ts', surface: 'Web line status messages', where: 'Decline reasons, the decline with its appeal, the final decline, and the lines around an organizer’s note', shot: `${SHOTS}call-390-appeal.png` },
  { file: 'packages/core/src/payout-copy.ts', surface: 'PayPal / Venmo payout text', where: 'The subject of PayPal’s payout email and the note shown in PayPal or Venmo; {group} is the group’s name', shot: '(inside PayPal or Venmo; not in our UI)' },
  { file: 'packages/core/src/rail-notice.ts', surface: 'Rail refused notice', where: 'Sent when PayPal refuses a payout at the account level (no money moved)', shot: `${SHOTS}organizer-390-rail-refused.png (organizer side)` },
  { file: 'apps/web/lib/server/voice/phrases.ts', surface: 'Phone line prompts', where: 'Spoken by the phone line (text-to-speech) around the read-back; heard, never read', shot: '(audio only; docs/PHONE.md)' },
];

const FIXTURES = 'packages/agents/fixtures/scenarios';
const FIXTURE_VIDEO = { lan_vi: { transcript: '0:00–0:05 (first two sentences, on screen and spoken); full text 0:05–0:14', readBack: '0:06–0:14', 'notification › confirmed_waiting': '0:14–0:44', 'notification › approved_sending': '0:25–0:44', 'notification › paid': '0:27–0:57' }, rosa_es: { transcript: '0:57–1:04', readBack: '0:58–1:04' } };

// ---------------------------------------------------------------------------------------------------------
// TypeScript AST helpers
const isLangKey = (n) => typeof n === 'string' && (LANGS.includes(n) || n in VARIANTS);
const propName = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);

/** A readable rendering of a string-ish expression: slots become {name}, branches become "a | b". */
function textOf(node, sf) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return textOf(node.expression, sf);
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) s += `{${slotName(span.expression, sf)}}` + span.literal.text;
    return s;
  }
  if (ts.isConditionalExpression(node)) {
    const a = textOf(node.whenTrue, sf);
    const b = textOf(node.whenFalse, sf);
    return a !== null && b !== null ? `${a} | ${b}` : (a ?? b);
  }
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return textOf(node.body, sf);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = textOf(node.left, sf);
    const b = textOf(node.right, sf);
    return a !== null && b !== null ? a + b : null;
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return `{${slotName(node, sf)}}`;
  return null;
}

function slotName(expr, sf) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isCallExpression(expr)) {
    const a = expr.arguments[0];
    if (a) return slotName(a, sf);
  }
  if (ts.isElementAccessExpression(expr)) return slotName(expr.expression, sf);
  return expr.getText(sf).replace(/\s+/g, ' ').slice(0, 40);
}

/** Resolve a shorthand `en` (in `{ en, es: {...} }`) to its `const en = {...}` initializer in the same file. */
function resolveIdent(name, sf) {
  let found = null;
  const visit = (n) => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

const unwrap = (n) => {
  while (n && (ts.isAsExpression(n) || ts.isSatisfiesExpression?.(n) || ts.isParenthesizedExpression(n) || ts.isTypeAssertionExpression?.(n))) n = n.expression;
  return n;
};

/** Names of the enclosing function / variable / properties, outermost first, skipping language keys. */
function pathOf(node, sf) {
  const parts = [];
  for (let p = node.parent; p && p !== sf; p = p.parent) {
    if (ts.isPropertyAssignment(p) && !isLangKey(propName(p))) parts.unshift(propName(p));
    else if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) parts.unshift(p.name.text);
    else if (ts.isFunctionDeclaration(p) && p.name) parts.unshift(`${p.name.text}()`);
  }
  return parts.filter(Boolean).join(' › ');
}

const lineOf = (node, sf) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function langProps(obj) {
  const out = new Map();
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && isLangKey(propName(p))) out.set(propName(p), p.initializer);
    else if (ts.isShorthandPropertyAssignment(p) && isLangKey(p.name.text)) out.set(p.name.text, { shorthand: p.name.text });
  }
  return out;
}

function extractFile(src) {
  const abs = join(REPO, src.file);
  const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, src.file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rows = [];
  const seen = new Set();
  const add = (key, langKey, text, en, node) => {
    if (text === null || text === undefined) return;
    const variant = VARIANTS[langKey];
    const lang = variant ? variant[0] : langKey;
    const baseKey = key;
    if (variant) key = `${key} › ${variant[1]}`;
    if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(text)) return; // BCP-47 tags, not copy
    if (src.exclude?.some((x) => key === x || key.startsWith(`${x} › `))) return;
    // Two literals with the same path (e.g. one label per policy category): tell them apart by line.
    if (seen.has(`${src.file}#${key}@${lang}`)) key = `${key} (line ${lineOf(node, sf)})`;
    const id = `${src.file}#${key}@${lang}`;
    if (seen.has(id)) return;
    seen.add(id);
    const leaf = baseKey.split(' › ').pop();
    // The video shows Mrs. Lan's register (videoVariant): neutral Vietnamese rows of that source are not on screen.
    const video = lang === 'vi' && src.videoVariant && src.videoVariant !== langKey ? '' : (src.video?.[leaf]?.[lang] ?? '');
    rows.push({ id: `${src.file.split('/').pop().replace(/\.tsx?$/, '')}:${key}`, key, lang, text, en, enLookup: en === null ? { file: src.enFrom ?? src.file, leaf } : null, surface: src.surface, where: text === '' ? `${src.where}. NOT WRITTEN IN THIS LANGUAGE: the neighbor gets the English (or, for catalog messages, a back-translation-checked machine translation). Please write one.` : src.where, ref: `${src.file}:${lineOf(node, sf)}`, shot: src.shot, video });
  };
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const langs = langProps(node);
      if (langs.size >= 2) {
        const nested = [...langs.values()].map((v) => (v.shorthand ? unwrap(resolveIdent(v.shorthand, sf)) : unwrap(v)));
        if (nested.some((v) => v && ts.isObjectLiteralExpression(v))) {
          // Shape B: language → { key: text }
          const tables = new Map([...langs.keys()].map((l, i) => [l, nested[i]]));
          const en = tables.get('en');
          const enText = (k) => {
            if (!en || !ts.isObjectLiteralExpression(en)) return null;
            const p = en.properties.find((q) => ts.isPropertyAssignment(q) && propName(q) === k);
            return p ? textOf(p.initializer, sf) : null;
          };
          const base = pathOf(node, sf);
          for (const [lang, table] of tables) {
            if (lang === 'en' || !table || !ts.isObjectLiteralExpression(table)) continue;
            for (const p of table.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const k = propName(p);
              const t = ts.isPropertyAccessExpression(p.initializer) ? `(same text as ${p.initializer.getText(sf)}: reviewed in that row)` : textOf(p.initializer, sf);
              add(base ? `${base} › ${k}` : k, lang, t, enText(k), p);
            }
          }
          // Languages with no table at all: one empty row per English key, so the gap is reviewable.
          if (en && ts.isObjectLiteralExpression(en)) {
            for (const lang of REVIEW_LANGS.filter((l) => !tables.has(l))) {
              for (const p of en.properties) if (ts.isPropertyAssignment(p) && !ts.isPropertyAccessExpression(p.initializer)) add(base ? `${base} › ${propName(p)}` : propName(p), lang, '', textOf(p.initializer, sf), p);
            }
          }
          return; // inner objects handled
        }
        // Shape A: key → { lang: text }
        // A sibling `key: 'groceries'` (policy categories) names the literal better than a line number.
        const owner = ts.isPropertyAssignment(node.parent) && ts.isObjectLiteralExpression(node.parent.parent) ? node.parent.parent : null;
        const sib = owner?.properties.find((q) => ts.isPropertyAssignment(q) && ['key', 'id'].includes(propName(q)) && ts.isStringLiteral(q.initializer));
        const callArg = ts.isCallExpression(node.parent) && node.parent.arguments[0] && ts.isStringLiteral(node.parent.arguments[0]) ? node.parent.arguments[0].text : null;
        const tag = sib ? sib.initializer.text : callArg;
        const key = (pathOf(node, sf) || `line ${lineOf(node, sf)}`) + (tag ? ` [${tag}]` : '');
        const enNode = langs.get('en');
        const en = enNode && !enNode.shorthand ? textOf(enNode, sf) : null;
        let any = false;
        for (const [lang, v] of langs) {
          if (lang === 'en' || v.shorthand) continue;
          const t = textOf(v, sf);
          if (t !== null) {
            any = true;
            add(key, lang, t, en, node);
          }
        }
        if (any && en !== null && !src.noGaps) for (const lang of (src.gapLangs ?? REVIEW_LANGS).filter((l) => !langs.has(l))) add(key, lang, '', en, node);
        // A register variant that is missing simply uses the neutral Vietnamese text: not a gap.
        if (any) return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
// Scenario fixtures: transcripts, read-backs and the messages the demo and the video show.
function catalogEn(rows) {
  const out = {};
  for (const r of rows) if (r.ref.startsWith('packages/core/src/i18n.ts') && r.lang === 'vi') out[r.key.split(' › ').pop()] = r.en;
  return out;
}
const renderEn = (tpl, vars) =>
  tpl
    ?.replace(/\[\[([\s\S]*?)\]\]/g, (_, seg) => ([...seg.matchAll(/\{(\w+)\}/g)].every((m) => vars[m[1]]) ? seg : ''))
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`) ?? null;

function extractFixtures(enCatalog) {
  const rows = [];
  for (const f of readdirSync(join(REPO, FIXTURES)).filter((x) => x.endsWith('.json')).sort()) {
    const j = JSON.parse(readFileSync(join(REPO, FIXTURES, f), 'utf8'));
    if (j.lang === 'en') continue;
    const ref = `${FIXTURES}/${f}`;
    const base = { surface: 'Demo scenario fixture', ref, shot: j.id === 'lan_vi' ? `${SHOTS}demo-1920-lan-readback.png, ${SHOTS}demo-1920-lan-done.png` : j.id === 'rosa_es' ? `${SHOTS}demo-1920-rosa-done.png` : j.id === 'jean_ht' ? `${SHOTS}demo-1920-jean-done.png` : `${SHOTS}call-390-question.png` };
    const v = FIXTURE_VIDEO[j.id] ?? {};
    const push = (key, text, en, where, video = '') => text && rows.push({ id: `${j.id}:${key}`, key, lang: j.lang, text, en, where, video, ...base });
    push('transcript', j.transcript, j.englishText, `The neighbor’s own words (synthetic voice in the video${j.voice ? `, voice "${j.voice.openaiVoice}"` : ''}). Check it sounds like a real ${LANG_NAME[j.lang]} speaker`, v.transcript);
    const x = j.extraction ?? {};
    push('summaryNative', x.summaryNative, x.summaryEn, 'AI summary read back to the neighbor (fixture of what the model returns)');
    if (j.expected?.readBack) {
      const enRb = x.payout ? `Here is what I understood. Please tell me if it is right: ${x.summaryEn} If approved, the money goes to your ${x.payout.wallet === 'VENMO' ? 'Venmo' : 'PayPal'}: ${x.payout.value}.` : null;
      push('readBack', j.expected.readBack, enRb, 'The full read-back, as shown and spoken ("Nghe lại" / "Escuchar")', v.readBack);
    }
    if (j.expected?.clarifyingQuestion) push('clarifyingQuestion', j.expected.clarifyingQuestion, null, 'The one clarifying question for this scenario');
    for (const n of j.notifications ?? []) push(`notification › ${n.key}`, n.text, renderEn(enCatalog[n.key], n.vars ?? {}), `Thread message with code-filled slots (${JSON.stringify(n.vars ?? {})})`, v[`notification › ${n.key}`]);
  }
  // Offline translations for languages outside the vetted catalog (fr, tl, ko, ru…): what those neighbors see.
  const tr = JSON.parse(readFileSync(join(REPO, 'packages/agents/fixtures/translations.json'), 'utf8'));
  tr.entries.forEach((e, i) =>
    rows.push({ id: `translations:${i}`, key: `translation ${i + 1}`, lang: e.lang, text: e.translation, en: e.source, surface: 'Machine translation (fixture)', where: `Out-of-catalog message, machine-translated with a back-translation check. Back-translation: “${e.backTranslation}”`, ref: 'packages/agents/fixtures/translations.json', shot: '', video: '' }),
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
const csvCell = (s) => {
  const v = String(s ?? '');
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const COLS = ['#', 'ID', 'Surface', 'Where it appears', 'Source (file:line)', 'Screenshot', 'In video', 'English source', 'Translation under review', 'Status', 'OK? (Y / N / ?)', 'Suggested fix'];

/** Slots removed, NFC, whitespace collapsed: the same text with a renamed slot is still the same text. */
function normalizedHash(t) {
  let x = t.normalize('NFC');
  let prev;
  do {
    prev = x;
    x = x.replace(/\{[^{}]*\}/g, '');
  } while (x !== prev);
  return createHash('sha256').update(x.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
}
const BASELINE = JSON.parse(readFileSync(join(HERE, 'baseline.json'), 'utf8')).langs;
const NEW_TEXT = 'machine-assisted, pending native review';
const statusOf = (r) => (!r.text || r.text.startsWith('(same text as') ? '' : BASELINE[r.lang]?.includes(normalizedHash(r.text)) ? '' : NEW_TEXT);

/** English for variant-only tables (core i18n-vi.ts, the phone's VI_REGISTERS): the neutral row with the same leaf key. */
function fillEnglish(rows) {
  for (const r of rows) {
    if (!r.enLookup) continue;
    const twin = rows.find((x) => x.ref.startsWith(`${r.enLookup.file}:`) && x.en && x.key.split(' › ').pop() === r.enLookup.leaf);
    if (twin) r.en = twin.en;
  }
}

function build() {
  const rows = SOURCES.flatMap(extractFile);
  fillEnglish(rows);
  rows.push(...extractFixtures(catalogEn(rows)));
  const byLang = {};
  for (const l of REVIEW_LANGS) byLang[l] = rows.filter((r) => r.lang === l);
  const files = {};
  for (const l of REVIEW_LANGS) {
    const lines = [COLS.join(',')];
    byLang[l].forEach((r, i) =>
      lines.push([i + 1, r.id, r.surface, r.where, r.ref, r.shot, r.video, r.en ?? '(no English in source: see the key)', r.text, statusOf(r), '', ''].map(csvCell).join(',')),
    );
    // BOM so Excel opens UTF-8 (Vietnamese diacritics, Arabic) correctly.
    files[`${l}.csv`] = '﻿' + lines.join('\r\n') + '\r\n';
  }
  const summary = Object.fromEntries(REVIEW_LANGS.map((l) => [l, { rows: byLang[l].length, inVideo: byLang[l].filter((r) => r.video).length, gaps: byLang[l].filter((r) => !r.text).length, machineAssisted: byLang[l].filter((r) => statusOf(r)).length }]));
  files['strings.json'] = JSON.stringify({ generatedBy: 'docs/submission/review/extract.mjs', counts: summary, rows: rows.map((r) => ({ id: r.id, key: r.key, lang: r.lang, surface: r.surface, ref: r.ref, en: r.en, text: r.text, ...(statusOf(r) ? { status: statusOf(r) } : {}) })) }, null, 2) + '\n';
  return { files, summary };
}

const { files, summary } = build();
if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([f, c]) => !existsSync(join(HERE, f)) || readFileSync(join(HERE, f), 'utf8') !== c);
  if (stale.length) {
    console.error(`stale: ${stale.map(([f]) => f).join(', ')}. Run: node docs/submission/review/extract.mjs`);
    process.exit(1);
  }
  console.log('review packet is up to date');
} else {
  for (const [f, c] of Object.entries(files)) writeFileSync(join(HERE, f), c);
  console.log(`wrote ${Object.keys(files).length} files to ${relative(process.cwd(), HERE) || '.'}:`, summary);
}
