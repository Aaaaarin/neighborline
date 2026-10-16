#!/usr/bin/env node
// Packs @neighborline/paypal exactly as it would be published and fails if the tarball is not clean.
//
//   pnpm --filter @neighborline/paypal pack:check            # build, pack, check, print the file list
//   node scripts/pack-check.mjs --keep <dir>                 # also leave the .tgz in <dir> (the release workflow)
//
// Why `pnpm pack` and never `npm pack`: package.json points "exports" at src/*.ts for the workspace. pnpm applies the
// "publishConfig" overrides (dist/*.js + .d.ts, bin) and rewrites workspace:* ranges while packing; npm does not, so
// an `npm pack`/`npm publish` straight from this folder would ship a broken package. The release workflow therefore
// publishes the tarball this script produced and checked.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const keepIdx = process.argv.indexOf('--keep');
const keepDir = keepIdx > -1 ? process.argv[keepIdx + 1] : undefined;
const skipBuild = process.argv.includes('--no-build');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

if (!skipBuild) run('pnpm', ['run', 'build']);
const work = mkdtempSync(join(tmpdir(), 'nl-paypal-pack-'));
run('pnpm', ['pack', '--pack-destination', work]);
const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'));
if (!tgz) throw new Error('pnpm pack produced no tarball');
const unpacked = join(work, 'x');
mkdirSync(unpacked);
execFileSync('tar', ['-xzf', join(work, tgz), '-C', unpacked]);
const root = join(unpacked, 'package');

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(root, p));
  }
};
walk(root);
files.sort();

const problems = [];
const ALLOWED_TOP = new Set(['package.json', 'README.md', 'API.md', 'CHANGELOG.md', 'PAYPAL_NOTES.md', 'LICENSE']);
for (const f of files) {
  if (!ALLOWED_TOP.has(f) && !f.startsWith('dist/')) problems.push(`unexpected file in tarball: ${f}`);
  if (/\.(test|spec)\.|__tests__|(^|\/)(test|fixtures?|src)\//.test(f)) problems.push(`test/source file in tarball: ${f}`);
  if (/(^|\/)\.env|\.pem$|\.key$|\.npmrc$/.test(f)) problems.push(`secret-looking file in tarball: ${f}`);
}

// Content scan: anything that looks like a credential. The package reads every secret from env at runtime.
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic API key'],
  [/sk-(proj-)?[A-Za-z0-9]{20,}/, 'OpenAI API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/A21AA[A-Za-z0-9_-]{40,}/, 'PayPal access token'],
  [/npm_[A-Za-z0-9]{30,}/, 'npm token'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/(PAYPAL_CLIENT_SECRET|NEIGHBORLINE_APPROVAL_SECRET)\s*=\s*['"]?[A-Za-z0-9_-]{16,}/, 'hard-coded secret env value'],
];
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8');
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${what} pattern in ${f}`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const has = (p) => files.includes(p.replace(/^\.\//, ''));
const targets = [];
const collect = (v) => (typeof v === 'string' ? targets.push(v) : Object.values(v ?? {}).forEach(collect));
collect(pkg.exports);
targets.push(pkg.main, pkg.types, ...Object.values(pkg.bin ?? {}));
for (const t of targets) if (!t || !has(t)) problems.push(`package.json points at a file that is not in the tarball: ${t}`);
for (const sub of ['.', './approval', './webhooks', './mcp']) {
  const e = pkg.exports?.[sub];
  if (!e || typeof e !== 'object' || !e.types || !e.default) problems.push(`exports["${sub}"] needs { types, default }`);
  else if (Object.keys(e)[0] !== 'types') problems.push(`exports["${sub}"]: "types" must be the first condition`);
}
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, range] of Object.entries(pkg[field] ?? {})) if (String(range).startsWith('workspace:')) problems.push(`${field}.${name} is still ${range}`);
}
for (const [name, rel] of Object.entries(pkg.bin ?? {})) {
  const p = join(root, rel);
  if (!readFileSync(p, 'utf8').startsWith('#!/usr/bin/env node')) problems.push(`bin ${name} has no node shebang`);
}
if (pkg.sideEffects !== false) problems.push('sideEffects should be false');
if (pkg.type !== 'module') problems.push('type should be "module"');
if (!pkg.engines?.node) problems.push('engines.node missing');
if (pkg.private) problems.push('package is private');

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const size = files.reduce((s, f) => s + statSync(join(root, f)).size, 0);
console.log(`${pkg.name}@${pkg.version}  ${tgz}  (${kb(statSync(join(work, tgz)).size)} packed, ${kb(size)} unpacked, ${files.length} files)`);
for (const f of files) console.log(`  ${kb(statSync(join(root, f)).size).padStart(9)}  ${f}`);

if (keepDir) {
  mkdirSync(keepDir, { recursive: true });
  copyFileSync(join(work, tgz), join(keepDir, tgz));
  console.log(`tarball: ${join(keepDir, tgz)}`);
}
rmSync(work, { recursive: true, force: true });

if (problems.length) {
  console.error(`\npack-check FAILED (${problems.length}):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('\npack-check OK: exports, types, bin and file list are clean.');
