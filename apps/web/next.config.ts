import type { NextConfig } from 'next';
import { distTsconfigPath } from './lib/dist-tsconfig';

// Lets two dev/build processes share one checkout without clobbering each other's output.
const distDir = process.env.NEXT_DIST_DIR || '.next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir,
  // `next build`/`next dev` add `<distDir>/types/**/*.ts` to the tsconfig they are given. For a custom NEXT_DIST_DIR
  // they get a generated, git-ignored tsconfig that already has it, so the tracked tsconfig.json never changes
  // (next-env.d.ts is generated and git-ignored too). See lib/dist-tsconfig.ts.
  typescript: { tsconfigPath: distTsconfigPath(typeof __dirname === 'string' ? __dirname : process.cwd(), distDir) },
  // Workspace packages ship TypeScript source (see CLAUDE.md); Next transpiles them.
  transpilePackages: ['@neighborline/core', '@neighborline/db', '@neighborline/paypal', '@neighborline/agents', '@neighborline/passkeys', '@neighborline/approver'],
  // Loaded by Node at runtime instead of bundled: PGlite ships WASM + data files next to its JS,
  // postgres-js uses Node sockets, the Agent Toolkit is an optional server-only dependency.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', '@paypal/agent-toolkit'],
  poweredByHeader: false,
  devIndicators: false,
  // Workspace packages use NodeNext-style `./x.js` specifiers that point at `./x.ts` sources.
  webpack(config) {
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return config;
  },
};

export default nextConfig;
