import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'mcp/server': 'src/mcp/server.ts', 'mcp/bin': 'src/mcp/bin.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: { entry: { index: 'src/index.ts', 'mcp/server': 'src/mcp/server.ts' } },
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
});
