import { test, expect } from '../fixtures/webauthn.fixture.js';
import {
  currentUser,
  expectSignedInAs,
  logout,
  message,
  registerViaUi,
  submitLogin,
  uniqueName,
} from '../fixtures/app.js';

test.describe('Passkey Login', () => {
  test('should register and then login with a passkey', async ({
    page,
    authenticator: _authenticator,
  }) => {
    const username = uniqueName('logintest');

    await registerViaUi(page, username);
    await logout(page);

    // The virtual authenticator still holds the credential from registration.
    // It will automatically respond to navigator.credentials.get().
    await submitLogin(page);
    await expectSignedInAs(page, username);
  });

  test('should fail login without registered credential', async ({
    page,
    authenticator: _authenticator,
  }) => {
    // Go directly to login — no credentials on this authenticator
    await submitLogin(page);

    // The browser reports a missing passkey like a cancelled prompt
    await expect(message(page)).toHaveText('Authentication was cancelled.');
    await expect(page).toHaveURL(/#\/login$/);
    expect((await currentUser(page)).status).toBe(401);
  });

  test('should send visitors who are not signed in to the login page', async ({
    page,
  }) => {
    await page.goto('/#/dashboard');

    await expect(page).toHaveURL(/#\/login$/);
    await expect(
      page.getByRole('button', { name: 'Sign in with Passkey' }),
    ).toBeVisible();
  });

  test('should end the session on logout', async ({
    page,
    authenticator: _authenticator,
  }) => {
    await registerViaUi(page, uniqueName('logout'));
    expect((await currentUser(page)).status).toBe(200);

    await logout(page);
    expect((await currentUser(page)).status).toBe(401);

    // The dashboard is closed again as well
    await page.goto('/#/dashboard');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test.describe('API', () => {
    test('should reject a verification without a pending login', async ({
      request,
    }) => {
      const response = await request.post('/api/auth/login/verify', {
        data: { id: 'abc', rawId: 'abc', type: 'public-key', response: {} },
      });

      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: 'No pending login' });
    });

    test('should accept each login response only once', async ({
      page,
      request,
      authenticator: _authenticator,
    }) => {
      await registerViaUi(page, uniqueName('replay'));
      await logout(page);

      // Record what the browser sends to finish the login: the signed
      // response, and the cookie that carries the challenge
      const verifyRequest = page.waitForRequest('**/api/auth/login/verify');
      await submitLogin(page);
      const sent = await verifyRequest;
      await expect(page).toHaveURL(/#\/dashboard$/);

      // Sending the very same request again must not sign anyone in
      const replay = await request.post('/api/auth/login/verify', {
        headers: { cookie: (await sent.allHeaders()).cookie },
        data: sent.postDataJSON(),
      });

      expect(replay.status()).toBe(400);
      expect(await replay.json()).toEqual({ error: 'No pending login' });
    });
  });
});
