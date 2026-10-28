/**
 * `pnpm --filter @neighborline/golive build:browser`: bundle src/browser/spike-browser.ts into one IIFE,
 * dist-browser/spike.js, that sets `window.NLSpike` (docs/GOLIVE.md, "Running the sandbox spike from a browser").
 * Node builtins are shimmed: node:crypto → Web Crypto's randomUUID, Buffer → a base64 shim, the rest → stubs that
 * throw if ever called (they are only imported transitively).
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GOLIVE_DIR = join(HERE, '..', '..');
export const BUNDLE = join(GOLIVE_DIR, 'dist-browser', 'spike.js');
export const MAX_BYTES = 600 * 1024;

const STUBBED = ['fs', 'path', 'url', 'module', 'http', 'net', 'child_process', 'os'];

const nodeShims: Plugin = {
  name: 'node-shims',
  setup(b) {
    b.onResolve({ filter: /^(node:)?(crypto|fs|path|url|module|http|net|child_process|os)$/ }, (args) => {
      const name = args.path.replace(/^node:/, '');
      if (name === 'crypto') return { path: join(HERE, 'shims', 'crypto.ts') };
      if (STUBBED.includes(name)) return { path: join(HERE, 'shims', 'node-stub.ts') };
      return undefined;
    });
  },
};

export async function buildBrowserBundle(opts: { outfile?: string; minify?: boolean } = {}): Promise<{ file: string; bytes: number }> {
  const outfile = opts.outfile ?? BUNDLE;
  const r = await build({
    entryPoints: [join(HERE, 'spike-browser.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: opts.minify ?? true,
    legalComments: 'none',
    outfile,
    inject: [join(HERE, 'shims', 'buffer.ts')],
    plugins: [nodeShims],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    banner: { js: '/* Neighborline golive browser spike: window.NLSpike. Credentials only from sessionStorage nl_main / nl_payouts; see docs/GOLIVE.md. */' },
  });
  if (r.errors.length) throw new Error(r.errors.map((e) => e.text).join('\n'));
  const bytes = statSync(outfile).size;
  if (bytes > MAX_BYTES) throw new Error(`browser bundle is ${bytes} bytes, over the ${MAX_BYTES} limit`);
  return { file: outfile, bytes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { file, bytes } = await buildBrowserBundle({ minify: !process.argv.includes('--no-minify') });
  console.log(`wrote ${file} (${(bytes / 1024).toFixed(1)} KB)`);
}
