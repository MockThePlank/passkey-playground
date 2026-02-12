import { test, expect } from '../fixtures/webauthn.fixture.js';

test.describe('Passkey Registration', () => {
  test('should register a new user with a passkey', async ({
    page,
    authenticator,
  }) => {
    // Navigate to register page
    await page.goto('/#/register');

    // Fill in username
    await page.fill('#username', 'testuser');

    // Click register — the virtual authenticator will handle the ceremony
    await page.click('#register-btn');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard');

    // Verify we're on the dashboard and username is displayed
    await expect(page.locator('.user-badge')).toContainText('testuser');

    // Verify a credential was stored on the virtual authenticator
    const credentials = await authenticator.getCredentials();
    expect(credentials).toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);
    expect(credentials[0].rpId).toBe('localhost');
  });

  test('should show error for empty username', async ({ page }) => {
    await page.goto('/#/register');

    // Click register without entering a username
    await page.click('#register-btn');

    // Should show error message
    await expect(page.locator('#message')).toContainText(
      'Please enter a username',
    );
  });
});
