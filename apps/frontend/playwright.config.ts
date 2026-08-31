import { defineConfig, devices } from '@playwright/test';

/**
 * [print-editor-dsk P9] — Playwright config for the print-formats e2e suite.
 *
 *  - `baseURL` defaults to the production vhost (`https://vendix.com`) so
 *    the same suite runs against staging and prod by overriding
 *    `E2E_BASE_URL` at the CLI.
 *  - `webServer` is intentionally NOT configured: the suite assumes the
 *    app is already running (local dev container, staging, or prod).
 *    Starting `ng serve` from Playwright would compete with the dev
 *    workflow that already runs the app on port 4200.
 *  - `projects` lists Chromium only — the print-format editor targets
 *    desktop browsers; mobile is covered by the Expo app's own suite.
 *  - Specs live under `e2e/` so they don't collide with Karma specs
 *    under `__tests__/`.
 *
 * Required env: `E2E_EMAIL`, `E2E_PASSWORD`. `E2E_BASE_URL` is optional
 * (defaults to `https://vendix.com`).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://vendix.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
