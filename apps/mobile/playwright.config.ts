import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the static web build of the app.
 *
 * They talk to a real platform instance on :8080 — testnet — and place real
 * testnet orders, so they are not run on every commit. The static build is
 * served from dist/; `npm run web:export` produces it.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8082',
    // iPhone viewport and touch, on Chromium: only Chromium is installed here.
    ...devices['iPhone 15'],
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8082 --directory dist',
    url: 'http://localhost:8082',
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
