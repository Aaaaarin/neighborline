import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (see CLAUDE.md); Next transpiles them.
  transpilePackages: ['@neighborline/core', '@neighborline/db', '@neighborline/paypal', '@neighborline/agents', '@neighborline/passkeys'],
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
