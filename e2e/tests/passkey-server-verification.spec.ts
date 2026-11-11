import {
  test,
  expect,
  createVirtualAuthenticator,
} from '../fixtures/webauthn.fixture.js';
import {
  currentUser,
  logout,
  registerViaUi,
  uniqueName,
} from '../fixtures/app.js';
import {
  createAuthentication,
  createRegistration,
  verify,
  withBrokenSignature,
  withClientData,
  withRelyingParty,
} from '../fixtures/ceremony.js';

// ─── What the Server Must Reject ────────────────────────────────────
//
// The other specs drive the app, and the app is honest: whatever the
// authenticator returns goes to the server unchanged. A failed fingerprint
// check, for example, ends in the browser, and the server never hears of
// it. Those tests therefore say little about the server's own checks.
//
// Here the test plays a client that cannot be trusted. It runs the ceremony
// itself (see fixtures/ceremony.ts), changes the request or the response,
// and expects the server to refuse. Every test also checks that nobody is
// signed in afterwards.

const REJECTED = { status: 400, body: { error: 'Verification failed' } };

test.describe('Server verification', () => {
  test.beforeEach(async ({ page }) => {
    // The ceremonies run in the page, so it has to be on the app's origin
    await page.goto('/');
  });

  // The app asks for user verification. A client can ignore that and ask
  // the authenticator for less. The response then lacks the "user verified"
  // flag, and only the server can notice.
  test.describe('user verification', () => {
    test.describe('at registration', () => {
      // A security key without a PIN: it cannot verify anyone. Chromium
      // lets such a key create an ordinary credential, but no discoverable
      // one, so the client asks for less on both counts.
      test.use({
        authenticatorOptions: { transport: 'usb', hasUserVerification: false },
      });

      test('should reject a registration without user verification', async ({
        page,
        authenticator: _authenticator,
      }) => {
        const response = await createRegistration(page, uniqueName('no-uv'), {
          userVerification: 'discouraged',
          residentKey: 'discouraged',
        });

        expect(await verify(page, 'register', response)).toEqual(REJECTED);
        expect((await currentUser(page)).status).toBe(401);
      });
    });

    test('should reject a login without user verification', async ({
      page,
      authenticator,
    }) => {
      await registerViaUi(page, uniqueName('no-uv-login'));
      await logout(page);

      // The fingerprint does not match, and the client does not insist
      await authenticator.setUserVerified(false);
      const response = await createAuthentication(page, {
        userVerification: 'discouraged',
      });

      expect(await verify(page, 'login', response)).toEqual(REJECTED);
      expect((await currentUser(page)).status).toBe(401);
    });
  });

  // clientDataJSON is where the browser states which challenge it answered
  // and on which origin. In a registration without attestation nothing
  // signs it, so the server's comparison is the only protection.
  test.describe('tampered registration', () => {
    test('should reject a response from another origin', async ({
      page,
      authenticator: _authenticator,
    }) => {
      const response = await createRegistration(page, uniqueName('origin'));
      const forged = withClientData(response, {
        origin: 'https://evil.example',
      });

      expect(await verify(page, 'register', forged)).toEqual(REJECTED);
      expect((await currentUser(page)).status).toBe(401);
    });

    test('should reject a response to another challenge', async ({
      page,
      authenticator: _authenticator,
    }) => {
      const response = await createRegistration(page, uniqueName('challenge'));
      const forged = withClientData(response, {
        challenge: Buffer.from('not the challenge').toString('base64url'),
      });

      expect(await verify(page, 'register', forged)).toEqual(REJECTED);
      expect((await currentUser(page)).status).toBe(401);
    });

    // The relying party ID is not in clientDataJSON but, hashed, in the
    // authenticator data
    test('should reject a response for another relying party', async ({
      page,
      authenticator: _authenticator,
    }) => {
      const response = await createRegistration(page, uniqueName('rp'));
      const forged = withRelyingParty(response, 'localhost', 'evil.example');

      expect(await verify(page, 'register', forged)).toEqual(REJECTED);
      expect((await currentUser(page)).status).toBe(401);
    });

    test('should reject a login response sent as a registration', async ({
      page,
      authenticator: _authenticator,
    }) => {
      const response = await createRegistration(page, uniqueName('type'));
      const forged = withClientData(response, { type: 'webauthn.get' });

      expect(await verify(page, 'register', forged)).toEqual(REJECTED);
      expect((await currentUser(page)).status).toBe(401);
    });
  });

  // A login response is signed, clientDataJSON included. Changing the
  // origin or the challenge in it therefore breaks the signature too, and
  // such a test could not tell which check refused it. That is why origin
  // and challenge are tested with registrations above.
  test.describe('tampered login', () => {
    test.beforeEach(async ({ page, authenticator: _authenticator }) => {
      await registerViaUi(page, uniqueName('tamper'));
      await logout(page);
    });

    test('should accept the untouched response', async ({ page }) => {
      // The control: the helpers themselves produce a valid login, so the
      // rejections below are caused by the tampering and nothing else
      const response = await createAuthentication(page);

      expect((await verify(page, 'login', response)).status).toBe(200);
      expect((await currentUser(page)).status).toBe(200);
    });

    test('should reject a broken signature', async ({ page }) => {
      const response = await createAuthentication(page);

      expect(
        await verify(page, 'login', withBrokenSignature(response)),
      ).toEqual(REJECTED);
      expect((await currentUser(page)).status).toBe(401);
    });

    test('should reject a passkey the server does not know', async ({
      page,
      authenticator,
    }) => {
      const response = await createAuthentication(page);
      const [passkey] = await authenticator.getCredentials();
      const unknownId = Buffer.from('unknown passkey').toString('base64url');
      expect(unknownId).not.toBe(passkey.credentialId);

      expect(
        await verify(page, 'login', {
          ...response,
          id: unknownId,
          rawId: unknownId,
        }),
      ).toEqual({ status: 400, body: { error: 'Credential not found' } });
      expect((await currentUser(page)).status).toBe(401);
    });
  });

  // The server checks who owns a username twice: when it issues the
  // options, and again when it stores the passkey. The second check is
  // for a name that was free when the ceremony started and taken when it
  // ended.
  test('should not add a passkey to an account claimed during the ceremony', async ({
    browser,
    baseURL,
  }) => {
    const username = uniqueName('claimed');
    const slowContext = await browser.newContext({ baseURL });
    const fastContext = await browser.newContext({ baseURL });

    try {
      // The slow visitor starts registering while the name is free ...
      const slow = await slowContext.newPage();
      await slow.goto('/');
      await createVirtualAuthenticator(slow);
      const response = await createRegistration(slow, username);

      // ... the fast one completes a registration for the same name ...
      const fast = await fastContext.newPage();
      await createVirtualAuthenticator(fast);
      await registerViaUi(fast, username);

      // ... and the slow one must not end up inside that account
      expect(await verify(slow, 'register', response)).toEqual({
        status: 409,
        body: { error: 'Username is already taken' },
      });
      expect((await currentUser(slow)).status).toBe(401);
      expect((await currentUser(fast)).body.username).toBe(username);
    } finally {
      await fastContext.close();
      await slowContext.close();
    }
  });
});
