import { defineConfig } from 'tsup';

// One entry per public subpath (see package.json "publishConfig.exports"), plus the MCP bin.
const entries = {
  index: 'src/index.ts',
  approval: 'src/approval.ts',
  webhooks: 'src/entries/webhooks.ts',
  'mcp/server': 'src/mcp/server.ts',
};

export default defineConfig({
  entry: { ...entries, 'mcp/bin': 'src/mcp/bin.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: { entry: entries },
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
});
