import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Deletes the users a run creates; see the file for details
  globalSetup: './global-setup.ts',
  fullyParallel: false, // WebAuthn tests share state, run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',

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
      },
    },
    // Every other spec uses CDP, which is Chromium-only. context.credentials
    // needs no CDP, so its demo can also run in other browsers.
    {
      name: 'webkit',
      testMatch: /passkey-credentials-demo\.spec\.ts$/,
      use: {
        ...devices['Desktop Safari'],
      },
    },
    // No Firefox project yet: it has not been possible to run it here.
    // See "Important Notes" in the README.
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
