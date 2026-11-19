import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Playwright's WebKit build for Linux has no window.PublicKeyCredential.
// context.credentials still replaces navigator.credentials there, but the
// app's WebAuthn library checks for that global first and stops with
// "WebAuthn is not supported in this browser". So the WebKit project only
// runs where the browser has WebAuthn: macOS and Windows.
const webkitHasWebAuthn = process.platform !== 'linux';

// The Firefox project uses the Firefox installed on the machine (channel
// 'moz-firefox', driven over WebDriver BiDi), not a Playwright build. These
// are the paths Playwright looks in for that channel. Without Firefox
// there, the project is left out instead of failing.
const firefoxPath = {
  darwin: '/Applications/Firefox.app/Contents/MacOS/firefox',
  linux: '/snap/bin/firefox',
  win32: join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Mozilla Firefox', 'firefox.exe'),
}[process.platform as string];
const firefoxInstalled = !!firefoxPath && existsSync(firefoxPath);

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
    ...(webkitHasWebAuthn
      ? [
          {
            name: 'webkit',
            testMatch: /passkey-credentials-demo\.spec\.ts$/,
            use: {
              ...devices['Desktop Safari'],
            },
          },
        ]
      : []),
    ...(firefoxInstalled
      ? [
          {
            name: 'firefox',
            testMatch: /passkey-credentials-demo\.spec\.ts$/,
            use: {
              ...devices['Desktop Firefox'],
              channel: 'moz-firefox',
            },
          },
        ]
      : []),
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
