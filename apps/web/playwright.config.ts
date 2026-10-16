import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const FAKE_PORT = Number(process.env.E2E_FAKE_PAYPAL_PORT ?? 4110);
const APPROVER_PORT = Number(process.env.E2E_APPROVER_PORT ?? 4120);
const DB_PORT = Number(process.env.E2E_DEV_DB_PORT ?? 4130);
const DATABASE_URL = `postgres://postgres@127.0.0.1:${DB_PORT}/postgres`;
// Per-run HMAC key shared by web and approver only (the fake PayPal and the database never see it).
const APPROVER_SECRET = (process.env.NEIGHBORLINE_APPROVER_SECRET ??= randomBytes(32).toString('hex'));
// Per-run session/invite key for the web server; e2e computes organizer invite codes from it.
const SESSION_SECRET = (process.env.NEIGHBORLINE_SESSION_SECRET ??= randomBytes(32).toString('hex'));

/**
 * E2E against a production build running the REAL engine in fake mode (no credentials), with the same
 * process layout as production: shared database (tools/dev-db), fake PayPal, the approver process
 * (the only one with a Payouts client), and the web app.
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } }, testIgnore: /(mobile|rules)\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    // Activating a new policy re-prices the shared queue, so the rules editor runs after everything else.
    { name: 'rules', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } }, testMatch: /rules\.spec\.ts/, dependencies: ['desktop', 'mobile'] },
  ],
  // Real engine in fake mode: dev-db + tools/fake-paypal + apps/approver + a production build.
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm --filter @neighborline/dev-db start',
          url: `http://127.0.0.1:${DB_PORT + 1}/health`,
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
          env: { DEV_DB_PORT: String(DB_PORT), DEV_DB_CONTROL_PORT: String(DB_PORT + 1) },
        },
        {
          command: 'pnpm --filter @neighborline/fake-paypal start',
          url: `http://127.0.0.1:${FAKE_PORT}/__fake/health`,
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
          env: { FAKE_PAYPAL_PORT: String(FAKE_PORT), WEBHOOK_TARGET_URL: `http://localhost:${PORT}/api/webhooks/paypal` },
        },
        {
          command: 'pnpm --filter @neighborline/approver start',
          url: `http://127.0.0.1:${APPROVER_PORT}/v1/health`,
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
          env: {
            APPROVER_PORT: String(APPROVER_PORT),
            NEIGHBORLINE_APPROVER_SECRET: APPROVER_SECRET,
            DATABASE_URL,
            PAYPAL_MODE: 'fake',
            FAKE_PAYPAL_URL: `http://127.0.0.1:${FAKE_PORT}`,
            DEMO_MODE: 'true',
          },
        },
        {
          command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
          url: `http://localhost:${PORT}/`,
          timeout: 300_000,
          reuseExistingServer: !process.env.CI,
          env: {
            PAYPAL_MODE: 'fake',
            FAKE_PAYPAL_URL: `http://127.0.0.1:${FAKE_PORT}`,
            AI_MODE: 'fixture',
            DEMO_MODE: 'true',
            DATABASE_URL,
            DEV_DB_CONTROL_URL: `http://127.0.0.1:${DB_PORT + 1}`,
            APPROVER_URL: `http://127.0.0.1:${APPROVER_PORT}`,
            NEIGHBORLINE_APPROVER_SECRET: APPROVER_SECRET,
            NEIGHBORLINE_SESSION_SECRET: SESSION_SECRET,
            // Every test shares one IP (localhost); the limiter itself is unit-tested.
            RATE_LIMITS: 'off',
            // Own build directory, so an e2e build never clobbers a running `next dev`.
            NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-e2e',
          },
        },
      ],
});
