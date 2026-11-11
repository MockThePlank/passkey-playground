import {
  test,
  expect,
  createVirtualAuthenticator,
} from '../fixtures/webauthn.fixture.js';
import {
  currentUser,
  expectSignedInAs,
  message,
  registerViaUi,
  submitRegistration,
  uniqueName,
} from '../fixtures/app.js';

test.describe('Passkey Registration', () => {
  test('should register a new user with a passkey', async ({
    page,
    authenticator,
  }) => {
    const username = uniqueName('testuser');

    // The virtual authenticator handles the ceremony
    await submitRegistration(page, username);
    await expectSignedInAs(page, username);

    // Verify a credential was stored on the virtual authenticator
    const credentials = await authenticator.getCredentials();
    expect(credentials).toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);
    expect(credentials[0].rpId).toBe('localhost');
  });

  test('should show error for empty username', async ({ page }) => {
    await page.goto('/#/register');

    // Click register without entering a username
    await page.getByRole('button', { name: 'Create Passkey' }).click();

    await expect(message(page)).toHaveText('Please enter a username.');
  });

  test.describe('existing usernames', () => {
    test('should not let a second person claim a username', async ({
      browser,
      baseURL,
    }) => {
      const username = uniqueName('owner');

      const ownerContext = await browser.newContext({ baseURL });
      const otherContext = await browser.newContext({ baseURL });

      try {
        const owner = await ownerContext.newPage();
        await createVirtualAuthenticator(owner);
        await registerViaUi(owner, username);

        const other = await otherContext.newPage();
        const otherAuthenticator = await createVirtualAuthenticator(other);

        // A padded name must not count as a different account
        for (const attempt of [username, `  ${username}  `]) {
          await submitRegistration(other, attempt);
          await expect(message(other)).toHaveText('Username is already taken');
          expect((await currentUser(other)).status).toBe(401);
        }

        // The ceremony never started, so no passkey was created
        expect(await otherAuthenticator.getCredentials()).toHaveLength(0);
      } finally {
        await otherContext.close();
        await ownerContext.close();
      }
    });

    test('should let the signed-in owner add another passkey', async ({
      page,
      authenticator,
    }) => {
      const username = uniqueName('multi');
      await registerViaUi(page, username);
      const before = await currentUser(page);

      // Without this, excludeCredentials rejects the same authenticator
      await authenticator.clearCredentials();

      await registerViaUi(page, username);

      expect(await authenticator.getCredentials()).toHaveLength(1);
      expect((await currentUser(page)).body.userId).toBe(before.body.userId);
    });

    test('should keep the signed-in identity during a pending registration', async ({
      page,
      authenticator: _authenticator,
    }) => {
      const username = uniqueName('identity');
      await registerViaUi(page, username);

      await page.request.post('/api/auth/register/options', {
        data: { username: `${username}-other` },
      });

      expect((await currentUser(page)).body.username).toBe(username);
    });
  });

  test.describe('API', () => {
    test('should reject invalid usernames', async ({ request }) => {
      for (const username of [123, '   ', 'x'.repeat(256)]) {
        const response = await request.post('/api/auth/register/options', {
          data: { username },
        });
        expect(response.status()).toBe(400);
      }
    });

    test('should reject a verification without a pending registration', async ({
      request,
    }) => {
      const response = await request.post('/api/auth/register/verify', {
        data: { id: 'abc', rawId: 'abc', type: 'public-key', response: {} },
      });

      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({
        error: 'No pending registration',
      });
    });

    test('should reject a body that is not a WebAuthn response', async ({
      request,
    }) => {
      for (const data of [{}, { id: 'abc' }, { id: 1, response: 'x' }]) {
        const response = await request.post('/api/auth/register/verify', {
          data,
        });
        expect(response.status()).toBe(400);
      }
    });
  });
});
