/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CDP WebAuthn Demo — A Guided Tour                              ║
 * ║                                                                  ║
 * ║  This file is the core learning resource of this project.        ║
 * ║  It explains step-by-step how to use Chrome DevTools Protocol    ║
 * ║  (CDP) to test WebAuthn/Passkey flows with Playwright.           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import type { CDPSession } from '@playwright/test';
import {
  test,
  expect,
  createVirtualAuthenticator,
} from '../fixtures/webauthn.fixture.js';
import {
  expectSignedInAs,
  loginViaUi,
  logout,
  message,
  registerViaUi,
  submitLogin,
  submitRegistration,
  uniqueName,
} from '../fixtures/app.js';

// =====================================================================
//  BACKGROUND: What is CDP?
// =====================================================================
//
//  The Chrome DevTools Protocol (CDP) is the protocol that Chrome
//  DevTools uses to communicate with the browser. Playwright uses
//  CDP internally for Chromium-based browsers.
//
//  For WebAuthn testing, CDP exposes the "WebAuthn" domain which
//  lets us create virtual authenticators that intercept all
//  navigator.credentials.create() and navigator.credentials.get() calls.
//
//  This means: No physical security key, no fingerprint scanner,
//  no OS prompt. Everything is simulated in-process.
//
//  CDP Docs: https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/
//
//  How this tour is built: Steps 1 and 2 send the CDP commands by hand, so
//  you see exactly what happens. From Step 3 on the tests use the
//  `authenticator` fixture from fixtures/webauthn.fixture.ts, which wraps
//  those same commands and also cleans up when a test fails.
//
// =====================================================================

test.describe('CDP WebAuthn Demo', () => {

  // =====================================================================
  //  STEP 1: Getting a CDP Session
  // =====================================================================
  //
  //  Playwright provides `page.context().newCDPSession(page)` to get
  //  a CDP session. This session is scoped to the page — meaning
  //  the virtual authenticator only affects this specific page.
  //
  //  Important: CDP sessions are Chromium-only. Firefox and WebKit
  //  do NOT support CDP, so WebAuthn testing this way only works
  //  with Chromium-based browsers. For other browsers, see
  //  passkey-credentials-demo.spec.ts.
  //

  test('Step 1: Creating a CDP session and enabling WebAuthn', async ({ page }) => {
    // ───────────────────────────────────────────────────────────────
    //  Create a CDP session from the page context.
    //  This gives us direct access to the Chrome DevTools Protocol.
    // ───────────────────────────────────────────────────────────────
    const cdpSession: CDPSession = await page.context().newCDPSession(page);

    // ───────────────────────────────────────────────────────────────
    //  Enable the WebAuthn domain.
    //
    //  Once enabled, the browser will intercept ALL WebAuthn API calls
    //  (navigator.credentials.create/get) and route them through
    //  virtual authenticators instead of real hardware.
    //
    //  Options:
    //    enableUI: false  → Suppress the native browser WebAuthn dialog.
    //                       Without this, Chromium may still show a
    //                       "Use your passkey" popup.
    // ───────────────────────────────────────────────────────────────
    await cdpSession.send('WebAuthn.enable', {
      enableUI: false,
    });

    // ───────────────────────────────────────────────────────────────
    //  WebAuthn is intercepted now, but there is no authenticator yet.
    //  A ceremony does not fail: it waits, like a browser waiting for
    //  you to plug in a security key.
    // ───────────────────────────────────────────────────────────────
    const username = uniqueName('late-authenticator');
    await submitRegistration(page, username);
    await expect(
      page.getByRole('button', { name: 'Waiting for passkey...' }),
    ).toBeDisabled();
    await expect(message(page)).toBeEmpty();

    // ───────────────────────────────────────────────────────────────
    //  As soon as an authenticator appears, it answers the waiting
    //  ceremony. Step 2 looks at this command and its options.
    // ───────────────────────────────────────────────────────────────
    await cdpSession.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await expectSignedInAs(page, username);

    // ───────────────────────────────────────────────────────────────
    //  Cleanup: disable when done. (Playwright discards the browser
    //  context after each test anyway, so nothing leaks if a test
    //  fails before this line.)
    // ───────────────────────────────────────────────────────────────
    await cdpSession.send('WebAuthn.disable');
  });


  // =====================================================================
  //  STEP 2: Adding a Virtual Authenticator
  // =====================================================================
  //
  //  A virtual authenticator simulates a physical device:
  //    - Platform authenticator (TouchID, FaceID, Windows Hello)
  //    - Roaming authenticator (USB security key, NFC, Bluetooth)
  //
  //  Key options explained:
  //
  //  protocol: 'ctap2'
  //    → CTAP2 is the modern protocol used by passkeys (FIDO2).
  //      Use 'u2f' only if you need to test legacy U2F flows.
  //
  //  transport: 'internal'
  //    → 'internal' = platform authenticator (built into the device)
  //    → 'usb' / 'ble' / 'nfc' = roaming authenticators
  //
  //  hasResidentKey: true
  //    → Enables discoverable credentials (= passkeys).
  //      This is what makes "passwordless" login possible:
  //      the credential is stored ON the authenticator and can
  //      be discovered without the server providing an ID.
  //
  //  hasUserVerification: true
  //    → The authenticator supports UV (biometrics, PIN, etc.)
  //
  //  isUserVerified: true
  //    → Automatically passes user verification. Set to false
  //      to simulate a scenario where UV fails.
  //
  //  automaticPresenceSimulation: true
  //    → Simulates "user touched the authenticator" automatically.
  //      Without this, you'd need to manually trigger presence.
  //

  test('Step 2: Adding and inspecting a virtual authenticator', async ({ page }) => {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('WebAuthn.enable', { enableUI: false });

    // ───────────────────────────────────────────────────────────────
    //  Add a virtual authenticator that mimics TouchID/FaceID.
    // ───────────────────────────────────────────────────────────────
    const { authenticatorId } = await cdpSession.send(
      'WebAuthn.addVirtualAuthenticator',
      {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      },
    );

    // authenticatorId is CDP's reference to this authenticator instance.
    // Every later command names the authenticator it is meant for.
    expect(authenticatorId).toEqual(expect.any(String));

    // A new authenticator holds no credentials
    const { credentials } = await cdpSession.send('WebAuthn.getCredentials', {
      authenticatorId,
    });
    expect(credentials).toEqual([]);

    // ───────────────────────────────────────────────────────────────
    //  From now on, any WebAuthn ceremony on this page is handled by
    //  the virtual authenticator, without any waiting.
    // ───────────────────────────────────────────────────────────────
    await registerViaUi(page, uniqueName('first-passkey'));

    const { credentials: afterRegistration } = await cdpSession.send(
      'WebAuthn.getCredentials',
      { authenticatorId },
    );
    expect(afterRegistration).toHaveLength(1);

    // Cleanup
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId,
    });
    await cdpSession.send('WebAuthn.disable');
  });


  // =====================================================================
  //  STEP 3: Full Registration + Login Flow
  // =====================================================================
  //
  //  From here on, the `authenticator` fixture does Steps 1 and 2 for us
  //  and removes the authenticator after the test. Its methods are thin
  //  wrappers; the CDP command behind each one is named in the comments.
  //

  test('Step 3: Full passkey flow with credential inspection', async ({
    page,
    authenticator,
  }) => {
    // ───────────────────────────────────────────────────────────────
    //  3a. Register a passkey
    // ───────────────────────────────────────────────────────────────
    const username = uniqueName('demo-user');
    await registerViaUi(page, username);

    // ───────────────────────────────────────────────────────────────
    //  3b. Inspect credentials via CDP (WebAuthn.getCredentials)
    //
    //  This returns all credentials stored on the virtual
    //  authenticator. It verifies that registration worked at the
    //  authenticator level, not just the UI level.
    //
    //  The result includes the private key. Do not log it in a real
    //  project.
    // ───────────────────────────────────────────────────────────────
    const credentials = await authenticator.getCredentials();
    expect(credentials).toHaveLength(1);

    const cred = credentials[0];
    expect(cred.isResidentCredential).toBe(true);
    expect(cred.rpId).toBe('localhost');
    // userHandle is the base64-encoded user ID from the server
    expect(cred.userHandle).toBeTruthy();
    // The CDP authenticator counts the registration itself as the first use
    expect(cred.signCount).toBe(1);

    // ───────────────────────────────────────────────────────────────
    //  3c. Logout and Login
    // ───────────────────────────────────────────────────────────────
    await logout(page);
    await loginViaUi(page, username);

    // ───────────────────────────────────────────────────────────────
    //  3d. Verify signCount incremented after login
    //
    //  The signature counter is a security mechanism. It increments
    //  on every use. If a server ever receives a counter value
    //  that is not higher than the stored one, it knows the
    //  credential may have been cloned.
    // ───────────────────────────────────────────────────────────────
    const [afterLogin] = await authenticator.getCredentials();
    expect(afterLogin.signCount).toBe(cred.signCount + 1);
  });


  // =====================================================================
  //  STEP 4: Multiple Authenticators
  // =====================================================================
  //
  //  You can add several virtual authenticators to one page, for example
  //  a platform authenticator and a USB key.
  //
  //  The browser sends a ceremony to all of them and uses the first answer.
  //  With automatic presence switched on everywhere, every authenticator
  //  answers: each one creates a passkey, and all but one are left behind
  //  unused. So a test with several authenticators has to say which one
  //  "the user touches", with WebAuthn.setAutomaticPresenceSimulation.
  //

  test('Step 4: Multiple authenticators', async ({ page, authenticator }) => {
    // `authenticator` is the platform authenticator from the fixture.
    // The USB key joins it on the same CDP session.
    const usbKey = await createVirtualAuthenticator(
      page,
      { transport: 'usb' },
      authenticator.cdpSession,
    );
    expect(usbKey.authenticatorId).not.toBe(authenticator.authenticatorId);

    // ───────────────────────────────────────────────────────────────
    //  4a. The user registers with the platform authenticator and
    //      leaves the USB key alone.
    // ───────────────────────────────────────────────────────────────
    await usbKey.setAutomaticPresence(false);

    const username = uniqueName('two-authenticators');
    await registerViaUi(page, username);

    // Each authenticator has its own credential store
    expect(await authenticator.getCredentials()).toHaveLength(1);
    expect(await usbKey.getCredentials()).toHaveLength(0);

    // ───────────────────────────────────────────────────────────────
    //  4b. Still signed in, the user adds the USB key as a second
    //      passkey for the same account.
    // ───────────────────────────────────────────────────────────────
    await authenticator.setAutomaticPresence(false);
    await usbKey.setAutomaticPresence(true);

    await registerViaUi(page, username);

    expect(await authenticator.getCredentials()).toHaveLength(1);
    expect(await usbKey.getCredentials()).toHaveLength(1);

    // ───────────────────────────────────────────────────────────────
    //  4c. The server knows both passkeys: the USB key alone is
    //      enough to sign in.
    // ───────────────────────────────────────────────────────────────
    await logout(page);
    await loginViaUi(page, username);

    const [usbPasskey] = await usbKey.getCredentials();
    expect(usbPasskey.signCount).toBe(2);
    const [platformPasskey] = await authenticator.getCredentials();
    expect(platformPasskey.signCount).toBe(1);

    await usbKey.remove();
  });


  // =====================================================================
  //  STEP 5: Simulating User Verification Failure
  // =====================================================================
  //
  //  With isUserVerified: false the authenticator offers user verification
  //  but it fails, as when a biometric check does not match.
  //
  //  The ceremony then ends in a NotAllowedError in the browser, and the
  //  server never gets a response to verify. The page cannot tell a failed
  //  check from a user cancelling, so the app shows its cancellation
  //  message.
  //
  //  context.credentials cannot reproduce this: its user verification always
  //  succeeds (see passkey-credentials-demo.spec.ts).
  //

  test.describe('with failing user verification', () => {
    // The fixture's settings can be changed per file or describe block
    test.use({ authenticatorOptions: { isUserVerified: false } });

    test('Step 5: User verification failure scenario', async ({
      page,
      authenticator,
    }) => {
      await submitRegistration(page, uniqueName('uv-fail'));

      // The message marks the end of the ceremony, so check it first. A
      // success would redirect shortly afterwards, which the URL check then
      // rules out.
      await expect(message(page)).toHaveText('Passkey creation was cancelled.');
      await expect(page).toHaveURL(/#\/register$/);

      // The failed ceremony left nothing on the authenticator
      expect(await authenticator.getCredentials()).toHaveLength(0);
    });
  });


  // =====================================================================
  //  STEP 6: Changing User Verification at Runtime
  // =====================================================================
  //
  //  WebAuthn.setUserVerified switches the outcome of user verification on
  //  an existing authenticator. That lets one test cover "it worked, then
  //  the fingerprint did not match, then it worked again" without setting
  //  up a second authenticator.
  //

  test('Step 6: Toggling user verification during a test', async ({
    page,
    authenticator,
  }) => {
    const username = uniqueName('uv-toggle');
    await registerViaUi(page, username);
    await logout(page);

    // The fingerprint no longer matches
    await authenticator.setUserVerified(false);
    await submitLogin(page);
    await expect(message(page)).toHaveText('Authentication was cancelled.');
    await expect(page).toHaveURL(/#\/login$/);

    // The failed attempt did not use the passkey
    const [unused] = await authenticator.getCredentials();
    expect(unused.signCount).toBe(1);

    // Second try with the right finger
    await authenticator.setUserVerified(true);
    await loginViaUi(page, username);
  });


  // =====================================================================
  //  STEP 7: Seeding a Passkey with addCredential
  // =====================================================================
  //
  //  WebAuthn.addCredential puts a passkey on an authenticator without a
  //  ceremony. With a passkey the server already knows, a test can start
  //  at the login instead of registering first.
  //
  //  Here the passkey is captured from a registration in another browser
  //  context. In a real suite you would capture it once, or let your
  //  backend provision it, and reuse it across tests. The captured data
  //  contains the private key: keep it out of version control.
  //
  //  The context.credentials counterpart is create(), see Step 3b there.
  //

  test('Step 7: A captured passkey logs in from a new context', async ({
    browser,
    baseURL,
  }) => {
    const username = uniqueName('cdp-seed');
    const enrollContext = await browser.newContext({ baseURL });
    const seededContext = await browser.newContext({ baseURL });

    try {
      // Capture: let the app register a passkey, then read it back
      const enrollPage = await enrollContext.newPage();
      const enrollAuthenticator = await createVirtualAuthenticator(enrollPage);
      await registerViaUi(enrollPage, username);
      const [captured] = await enrollAuthenticator.getCredentials();

      // Seed: this context never ran a registration ceremony
      const seededPage = await seededContext.newPage();
      const seededAuthenticator = await createVirtualAuthenticator(seededPage);
      await seededAuthenticator.addCredential(captured);
      await loginViaUi(seededPage, username);

      // The seeded copy continues counting where the captured one stopped
      const [used] = await seededAuthenticator.getCredentials();
      expect(used.credentialId).toBe(captured.credentialId);
      expect(used.signCount).toBe(captured.signCount + 1);
    } finally {
      await seededContext.close();
      await enrollContext.close();
    }
  });


  // =====================================================================
  //  REFERENCE: All CDP WebAuthn Commands
  // =====================================================================
  //
  //  WebAuthn.enable              — Start intercepting WebAuthn calls (Step 1)
  //  WebAuthn.disable             — Stop intercepting (Step 1)
  //  WebAuthn.addVirtualAuthenticator   — Create a virtual authenticator (Step 1, 2)
  //  WebAuthn.removeVirtualAuthenticator — Remove one (Step 2)
  //  WebAuthn.getCredentials      — List all credentials on an authenticator (Step 2, 3)
  //  WebAuthn.addCredential       — Manually add a credential (Step 7)
  //  WebAuthn.removeCredential    — Remove a specific credential
  //  WebAuthn.clearCredentials    — Remove all credentials (passkey-register.spec.ts)
  //  WebAuthn.setUserVerified     — Toggle UV at runtime (Step 6)
  //  WebAuthn.setAutomaticPresenceSimulation — Toggle auto-presence (Step 4)
  //
  // =====================================================================
});
