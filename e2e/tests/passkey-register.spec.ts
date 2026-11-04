import {
  test,
  expect,
  createVirtualAuthenticator,
} from '../fixtures/webauthn.fixture.js';
import type { Page } from '@playwright/test';

async function register(page: Page, username: string) {
  await page.goto('/#/register');
  await page.fill('#username', username);
  await page.click('#register-btn');
}

function currentUser(page: Page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/auth/me');
    const body = (await res.json()) as { userId?: string; username?: string };
    return { status: res.status, body };
  });
}

test.describe('Passkey Registration', () => {
  test('should register a new user with a passkey', async ({
    page,
    authenticator,
  }) => {
    const username = `testuser-${Date.now()}`;

    // Navigate to register page
    await page.goto('/#/register');

    // Fill in username
    await page.fill('#username', username);

    // Click register — the virtual authenticator will handle the ceremony
    await page.click('#register-btn');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard');

    // Verify we're on the dashboard and username is displayed
    await expect(page.locator('.user-badge')).toContainText(username);

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

  test.describe('existing usernames', () => {
    test('should not let a second person claim a username', async ({
      browser,
      baseURL,
    }) => {
      const username = `owner-${Date.now()}`;

      const ownerContext = await browser.newContext({ baseURL });
      const owner = await ownerContext.newPage();
      await createVirtualAuthenticator(owner);
      await register(owner, username);
      await owner.waitForURL('**/dashboard');

      const otherContext = await browser.newContext({ baseURL });
      const other = await otherContext.newPage();
      const otherAuthenticator = await createVirtualAuthenticator(other);

      // A padded name must not count as a different account
      for (const attempt of [username, `  ${username}  `]) {
        await register(other, attempt);
        await expect(other.locator('#message')).toContainText(
          'Username is already taken',
        );
        expect((await currentUser(other)).status).toBe(401);
      }

      // The ceremony never started, so no passkey was created
      expect(await otherAuthenticator.getCredentials()).toHaveLength(0);

      await otherContext.close();
      await ownerContext.close();
    });

    test('should let the signed-in owner add another passkey', async ({
      page,
      authenticator,
    }) => {
      const username = `multi-${Date.now()}`;
      await register(page, username);
      await page.waitForURL('**/dashboard');
      const before = await currentUser(page);

      // Without this, excludeCredentials rejects the same authenticator
      await authenticator.clearCredentials();

      await register(page, username);
      await page.waitForURL('**/dashboard');

      expect(await authenticator.getCredentials()).toHaveLength(1);
      expect((await currentUser(page)).body.userId).toBe(before.body.userId);
    });

    test('should keep the signed-in identity during a pending registration', async ({
      page,
      authenticator,
    }) => {
      const username = `identity-${Date.now()}`;
      await register(page, username);
      await page.waitForURL('**/dashboard');

      await page.request.post('/api/auth/register/options', {
        data: { username: `${username}-other` },
      });

      expect((await currentUser(page)).body.username).toBe(username);
    });
  });

  test('should reject invalid usernames', async ({ request }) => {
    for (const username of [123, '   ', 'x'.repeat(256)]) {
      const response = await request.post('/api/auth/register/options', {
        data: { username },
      });
      expect(response.status()).toBe(400);
    }
  });
});
