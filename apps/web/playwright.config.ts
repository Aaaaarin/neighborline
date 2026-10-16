import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const FAKE_PORT = Number(process.env.E2E_FAKE_PAYPAL_PORT ?? 4110);

/**
 * E2E against a production build running the REAL engine in fake mode (no credentials).
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH (preinstalled in CI images).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  // Real engine in fake mode: tools/fake-paypal + a production build, webhooks delivered to the app.
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm --filter @neighborline/fake-paypal start',
          url: `http://127.0.0.1:${FAKE_PORT}/__fake/health`,
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
          env: { FAKE_PAYPAL_PORT: String(FAKE_PORT), WEBHOOK_TARGET_URL: `http://localhost:${PORT}/api/webhooks/paypal` },
        },
        {
          command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
          url: `http://localhost:${PORT}/`,
          timeout: 300_000,
          reuseExistingServer: !process.env.CI,
          env: { PAYPAL_MODE: 'fake', FAKE_PAYPAL_URL: `http://127.0.0.1:${FAKE_PORT}`, AI_MODE: 'fixture', DEMO_MODE: 'true' },
        },
      ],
});
