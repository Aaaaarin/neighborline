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
// Scenario fixtures (JSON) add the transcripts, read-backs and messages that the demo and the video show.
//
// Reviewers fill the last two columns ("OK?" and "Suggested fix"); see REVIEWER_GUIDE.md.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const require = createRequire(join(REPO, 'package.json'));
const ts = require('typescript');

const LANGS = ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'];
const REVIEW_LANGS = ['vi', 'es', 'ht', 'zh', 'ar', 'ko', 'ru', 'fr', 'tl'];
const LANG_NAME = { es: 'Spanish', vi: 'Vietnamese', ht: 'Haitian Creole', zh: 'Chinese (Simplified)', ar: 'Arabic (MSA)', fr: 'French', tl: 'Tagalog', ko: 'Korean', ru: 'Russian' };
const SHOTS = 'apps/web/screenshots/';

/**
 * Requester-facing sources, in the order a neighbor meets them. `where` is the surface, `shot` the screenshot
 * that shows it (relative to the repo), `video` the cut's timecodes when the video shows it.
 */
const SOURCES = [
  { file: 'apps/web/lib/i18n.ts', exclude: ['speechTag()'], surface: 'Web line UI (/call and the stage phone)', where: 'Buttons, labels, placeholders and status steps on the neighbor’s phone', shot: `${SHOTS}call-390.png, ${SHOTS}call-390-readback.png, ${SHOTS}call-390-question.png`, video: { lineSub: { vi: '0:05–0:44', es: '0:57–1:21' }, listen: { vi: '0:06–0:14' }, translated: { vi: '0:05–0:44', es: '0:57–1:21' }, arrived: { vi: '0:27–0:44', es: '1:15–1:21' }, composer: { vi: '0:05–0:44', es: '0:57–1:21' }, yes: { vi: '0:13', es: '1:00' }, claim: { es: '1:09–1:15' } } },
  { file: 'packages/core/src/i18n.ts', surface: 'Message catalog (thread messages)', where: 'Messages the line sends into the neighbor’s thread; code fills {amount} {wallet} {name}', shot: `${SHOTS}demo-1920-lan-done.png (left phone), ${SHOTS}demo-1920-rosa-done.png`, video: { readback_intro: { vi: '0:06–0:14', es: '0:58–1:04' }, confirmed_waiting: { vi: '0:14–0:44', es: '1:00–1:08' }, approved_sending: { vi: '0:25–0:44', es: '1:04–1:09' }, paid: { vi: '0:27–0:57', es: '1:15–1:21' }, unclaimed_help: { es: '1:09–1:21' } } },
  { file: 'packages/agents/src/intake/phrases.ts', surface: 'Read-back framing and clarifying questions', where: 'Wraps the AI summary in the read-back; the one clarifying question', shot: `${SHOTS}call-390-readback.png, ${SHOTS}call-390-question.png`, video: { payout_line: { vi: '0:06–0:14', es: '0:58–1:04' } } },
  { file: 'apps/web/lib/server/engine/conversation.ts', surface: 'Quick answers', where: 'Tappable answers under a clarifying question (household size, category)', shot: `${SHOTS}call-390-household.png, ${SHOTS}call-390-question.png` },
  { file: 'packages/core/src/policy.ts', noGaps: true, surface: 'Category labels', where: 'Category names the neighbor taps as a quick answer or sees in the read-back (demo group policy v1; fr/tl/ko/ru come from the Quick answers rows)', shot: `${SHOTS}call-390-question.png` },
  { file: 'apps/web/lib/server/fixtures/templates.ts', exclude: ['LANG_EN'], surface: 'Web line status messages', where: 'Acknowledgement, sending, paid with transaction id, claim help, decline and appeal texts in the neighbor’s thread', shot: `${SHOTS}call-390-appeal.png, ${SHOTS}demo-1920-rosa-done.png` },
  { file: 'packages/core/src/payout-copy.ts', surface: 'PayPal / Venmo payout text', where: 'The subject of PayPal’s payout email and the note shown in PayPal or Venmo; {group} is the group’s name', shot: '(inside PayPal or Venmo; not in our UI)' },
  { file: 'packages/core/src/rail-notice.ts', surface: 'Rail refused notice', where: 'Sent when PayPal refuses a payout at the account level (no money moved)', shot: `${SHOTS}organizer-390-rail-refused.png (organizer side)` },
  { file: 'apps/web/lib/server/voice/phrases.ts', surface: 'Phone line prompts', where: 'Spoken by the phone line (text-to-speech) around the read-back; heard, never read', shot: '(audio only; docs/PHONE.md)' },
];

const FIXTURES = 'packages/agents/fixtures/scenarios';
const FIXTURE_VIDEO = { lan_vi: { transcript: '0:00–0:05 (first two sentences, on screen and spoken); full text 0:05–0:14', readBack: '0:06–0:14', 'notification › confirmed_waiting': '0:14–0:44', 'notification › paid': '0:27–0:57' }, rosa_es: { transcript: '0:57–1:04', readBack: '0:58–1:04' } };

// ---------------------------------------------------------------------------------------------------------
// TypeScript AST helpers
const isLangKey = (n) => typeof n === 'string' && LANGS.includes(n);
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
  const add = (key, lang, text, en, node) => {
    if (text === null || text === undefined) return;
    if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(text)) return; // BCP-47 tags, not copy
    if (src.exclude?.some((x) => key === x || key.startsWith(`${x} › `))) return;
    // Two literals with the same path (e.g. one label per policy category): tell them apart by line.
    if (seen.has(`${src.file}#${key}@${lang}`)) key = `${key} (line ${lineOf(node, sf)})`;
    const id = `${src.file}#${key}@${lang}`;
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id: `${src.file.split('/').pop().replace(/\.tsx?$/, '')}:${key}`, key, lang, text, en, surface: src.surface, where: text === '' ? `${src.where}. NOT WRITTEN IN THIS LANGUAGE: the neighbor gets the English (or, for catalog messages, a back-translation-checked machine translation). Please write one.` : src.where, ref: `${src.file}:${lineOf(node, sf)}`, shot: src.shot, video: src.video?.[key.split(' › ').pop()]?.[lang] ?? '' });
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
const COLS = ['#', 'ID', 'Surface', 'Where it appears', 'Source (file:line)', 'Screenshot', 'In video', 'English source', 'Translation under review', 'OK? (Y / N / ?)', 'Suggested fix'];

function build() {
  const rows = SOURCES.flatMap(extractFile);
  rows.push(...extractFixtures(catalogEn(rows)));
  const byLang = {};
  for (const l of REVIEW_LANGS) byLang[l] = rows.filter((r) => r.lang === l);
  const files = {};
  for (const l of REVIEW_LANGS) {
    const lines = [COLS.join(',')];
    byLang[l].forEach((r, i) =>
      lines.push([i + 1, r.id, r.surface, r.where, r.ref, r.shot, r.video, r.en ?? '(no English in source: see the key)', r.text, '', ''].map(csvCell).join(',')),
    );
    // BOM so Excel opens UTF-8 (Vietnamese diacritics, Arabic) correctly.
    files[`${l}.csv`] = '﻿' + lines.join('\r\n') + '\r\n';
  }
  const summary = Object.fromEntries(REVIEW_LANGS.map((l) => [l, byLang[l].length]));
  files['strings.json'] = JSON.stringify({ generatedBy: 'docs/submission/review/extract.mjs', counts: summary, rows: rows.map(({ id, key, lang, text, en, surface, ref }) => ({ id, key, lang, surface, ref, en, text })) }, null, 2) + '\n';
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
