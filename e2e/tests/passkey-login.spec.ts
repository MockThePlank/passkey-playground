import { test, expect } from '../fixtures/webauthn.fixture.js';

test.describe('Passkey Login', () => {
  test('should register and then login with a passkey', async ({
    page,
    authenticator,
  }) => {
    // ─── Step 1: Register a user first ──────────────────────────────
    await page.goto('/#/register');
    await page.fill('#username', 'logintest');
    await page.click('#register-btn');
    await page.waitForURL('**/dashboard');

    // Verify registration worked
    await expect(page.locator('.user-badge')).toContainText('logintest');

    // ─── Step 2: Logout ─────────────────────────────────────────────
    await page.click('#logout-btn');
    await page.waitForURL('**/login');

    // ─── Step 3: Login with the same passkey ────────────────────────
    await page.click('#login-btn');

    // The virtual authenticator still holds the credential from registration.
    // It will automatically respond to navigator.credentials.get().

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard');

    // Verify login worked
    await expect(page.locator('.user-badge')).toContainText('logintest');
  });

  test('should fail login without registered credential', async ({
    page,
    authenticator,
  }) => {
    // Go directly to login — no credentials on this authenticator
    await page.goto('/#/login');
    await page.click('#login-btn');

    // Should show an error (authenticator has no matching credentials)
    await expect(page.locator('#message')).toBeVisible();
  });
});
