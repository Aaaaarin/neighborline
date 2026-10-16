import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: { include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts', 'src/test-db.ts', 'src/scripts/**', 'src/migrations.generated.ts'] },
  },
});
