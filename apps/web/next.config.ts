import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (see CLAUDE.md); Next transpiles them.
  transpilePackages: ['@neighborline/core'],
  poweredByHeader: false,
  devIndicators: false,
  // Workspace packages use NodeNext-style `./x.js` specifiers that point at `./x.ts` sources.
  webpack(config) {
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return config;
  },
};

export default nextConfig;
