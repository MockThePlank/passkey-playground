import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // WebAuthn tests share state, run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CDP is Chromium-only — WebAuthn virtual authenticators
        // require the Chrome DevTools Protocol
      },
    },
    // WebAuthn CDP is NOT available in Firefox or WebKit.
    // This is intentional — the project demonstrates Chromium CDP testing.
  ],

  // Start both server and client before tests
  webServer: [
    {
      command: 'npm run dev:server',
      cwd: '..',
      port: 3000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:client',
      cwd: '..',
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
