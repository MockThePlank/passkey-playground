/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  context.credentials Demo — A Guided Tour                       ║
 * ║                                                                  ║
 * ║  The counterpart to passkey-cdp-demo.spec.ts. It covers the same ║
 * ║  flows with Playwright's built-in passkey API, which needs no    ║
 * ║  CDP session and also runs outside Chromium.                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { test, expect } from '@playwright/test';
import {
  expectSignedInAs,
  loginViaUi,
  logout,
  message,
  registerViaUi,
  submitLogin,
  uniqueName,
} from '../fixtures/app.js';

// =====================================================================
//  BACKGROUND: How is this different from CDP?
// =====================================================================
//
//  CDP adds a virtual authenticator inside the browser, so the browser's
//  own WebAuthn stack still runs.
//
//  context.credentials (since Playwright 1.61) replaces
//  navigator.credentials.create() and .get() with a script. The keys and
//  signatures are produced in the Playwright process. That is why it
//  works across browsers, and also why it never tests how the browser
//  itself handles WebAuthn.
//
//  Your server still does its full job: it receives real attestations and
//  real signatures, and verifies them as usual.
//
//  Docs: https://playwright.dev/docs/api/class-credentials
//
// =====================================================================

const RP_ID = 'localhost';

test.describe('context.credentials Demo', () => {

  // =====================================================================
  //  STEP 1: install() and get()
  // =====================================================================
  //
  //  install() must run before the page first touches navigator.credentials.
  //  Without it nothing is intercepted, and the page gets the browser's
  //  real WebAuthn behaviour.
  //
  //  get() returns everything the authenticator holds, including passkeys
  //  the page registered itself. Each entry contains the PRIVATE KEY, so
  //  treat anything you save from it as a secret.
  //

  test('Step 1: Registering a passkey and reading it back', async ({
    context,
    page,
  }) => {
    await context.credentials.install();

    await registerViaUi(page, uniqueName('credentials-demo'));

    const credentials = await context.credentials.get({ rpId: RP_ID });
    expect(credentials).toHaveLength(1);

    const [credential] = credentials;
    expect(credential.rpId).toBe(RP_ID);
    expect(credential.userHandle).toBeTruthy();
    expect(credential.privateKey).toBeTruthy();
    expect(credential.publicKey).toBeTruthy();

    // Unlike the CDP authenticator, this one starts counting at 0
    expect(credential.signCount).toBe(0);

    // The rpId filter really filters
    expect(await context.credentials.get({ rpId: 'example.com' })).toEqual([]);
  });


  // =====================================================================
  //  STEP 2: Login
  // =====================================================================
  //
  //  Every successful navigator.credentials.get() raises the signature
  //  counter by one, which the server checks to detect cloned keys.
  //

  test('Step 2: Logging in raises the signature counter', async ({
    context,
    page,
  }) => {
    await context.credentials.install();

    const username = uniqueName('credentials-login');
    await registerViaUi(page, username);
    await logout(page);

    await loginViaUi(page, username);

    const [credential] = await context.credentials.get({ rpId: RP_ID });
    expect(credential.signCount).toBe(1);
  });


  // =====================================================================
  //  STEP 3: Seeding with create()
  // =====================================================================
  //
  //  create() puts a passkey on the authenticator without any ceremony.
  //  Three situations look alike but behave differently:
  //
  //    3a. Fresh keys: the authenticator has a passkey that the server
  //        has never heard of.
  //    3b. Known keys: the passkey was captured earlier, or your backend
  //        provisioned it. This is what makes login tests fast.
  //    3c. Known keys with an old counter: the server sees what looks
  //        like a cloned key.
  //

  test('Step 3a: A freshly generated passkey is unknown to the server', async ({
    context,
    page,
  }) => {
    await context.credentials.create(RP_ID);
    await context.credentials.install();

    await submitLogin(page);

    await expect(message(page)).toHaveText('Credential not found');
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('Step 3b: A captured passkey logs in from a new context', async ({
    browser,
    baseURL,
  }) => {
    const username = uniqueName('credentials-seed');

    // Capture: let the app register a passkey, then read it back
    const enrollContext = await browser.newContext({ baseURL });
    await enrollContext.credentials.install();
    await registerViaUi(await enrollContext.newPage(), username);
    const [captured] = await enrollContext.credentials.get({ rpId: RP_ID });
    await enrollContext.close();

    // Seed: this context never ran a registration ceremony
    const seededContext = await browser.newContext({ baseURL });
    await seededContext.credentials.create(captured.rpId, captured);
    await seededContext.credentials.install();
    await loginViaUi(await seededContext.newPage(), username);

    const [used] = await seededContext.credentials.get({ id: captured.id });
    expect(used.signCount).toBe(captured.signCount + 1);
    await seededContext.close();
  });

  test('Step 3c: A stale signature counter looks like a cloned key', async ({
    browser,
    baseURL,
  }) => {
    const username = uniqueName('credentials-counter');

    const original = await browser.newContext({ baseURL });
    await original.credentials.install();
    const originalPage = await original.newPage();
    await registerViaUi(originalPage, username);
    const [atEnrollment] = await original.credentials.get({ rpId: RP_ID });

    // This login moves the counter stored on the server to 1
    await logout(originalPage);
    await loginViaUi(originalPage, username);
    await original.close();

    // Re-seeding the old snapshot reports 1 again, which is not an increase
    const stale = await browser.newContext({ baseURL });
    await stale.credentials.create(atEnrollment.rpId, atEnrollment);
    await stale.credentials.install();
    const stalePage = await stale.newPage();
    await submitLogin(stalePage);
    await expect(message(stalePage)).toHaveText(
      'Verification failed',
    );
    await stale.close();

    // Continuing from the counter the server has seen works (since 1.64)
    const current = await browser.newContext({ baseURL });
    await current.credentials.create(atEnrollment.rpId, {
      ...atEnrollment,
      signCount: 1,
    });
    await current.credentials.install();
    await loginViaUi(await current.newPage(), username);
    await current.close();
  });


  // =====================================================================
  //  STEP 4: Reuse via storage state
  // =====================================================================
  //
  //  storageState({ credentials: true }) (since 1.62) saves passkeys next
  //  to the cookies. Restoring that state installs the authenticator on
  //  its own, so the new context does not call install().
  //
  //  The file contains private keys and a session cookie. Keep it out of
  //  version control. Here it lands in test-results/, which git ignores.
  //

  test('Step 4: Storage state restores the session and the passkey', async ({
    browser,
    baseURL,
    context,
    page,
  }) => {
    await context.credentials.install();

    const username = uniqueName('credentials-state');
    await registerViaUi(page, username);

    // Playwright's return type does not declare `credentials`, hence the casts
    type StateWithPasskeys = { credentials?: unknown[] };

    // Passkeys are only included on request
    const withoutPasskeys = (await context.storageState()) as StateWithPasskeys;
    expect(withoutPasskeys.credentials ?? []).toEqual([]);

    const path = test.info().outputPath('passkey-state.json');
    const state = (await context.storageState({
      path,
      credentials: true,
    })) as StateWithPasskeys;
    expect(state.credentials).toHaveLength(1);

    const restored = await browser.newContext({ baseURL, storageState: path });
    const restoredPage = await restored.newPage();

    // The cookie alone is enough to be signed in straight away...
    await restoredPage.goto('/#/dashboard');
    await expectSignedInAs(restoredPage, username);

    // ...and the passkey still works after signing out
    await logout(restoredPage);
    await loginViaUi(restoredPage, username);

    const [credential] = await restored.credentials.get({ rpId: RP_ID });
    expect(credential.signCount).toBe(1);
    await restored.close();
  });


  // =====================================================================
  //  STEP 5: What this API cannot simulate
  // =====================================================================
  //
  //  The documentation does not mention user verification or transports,
  //  so this step records what Playwright 1.64 does, as read from its source
  //  and checked below. If an upgrade changes it, this test fails and the
  //  README needs another look.
  //
  //  The authenticator has no settings, and it ignores most of the request:
  //
  //    - User verification always succeeds. The UV flag is set no matter
  //      what is requested, so a failed biometric check cannot be
  //      reproduced. CDP can do that: see Step 5 of the CDP demo.
  //    - The transport is always 'internal' and the attachment 'platform',
  //      so a USB, NFC or Bluetooth key cannot be imitated.
  //    - The algorithm is always ES256, with 'none' attestation.
  //

  test('Step 5a: The authenticator ignores what the request asks for', async ({
    context,
    page,
  }) => {
    await context.credentials.install();
    await page.goto('/#/login');

    const created = await page.evaluate(async () => {
      // e2e/tsconfig.json has no DOM lib, hence the cast
      const { credentials } = navigator as unknown as {
        credentials: { create(options: unknown): Promise<any> };
      };

      const credential = await credentials.create({
        publicKey: {
          challenge: new Uint8Array(32),
          rp: { id: 'localhost', name: 'Demo' },
          user: {
            id: new Uint8Array(16),
            name: 'request-demo',
            displayName: 'Request Demo',
          },
          // Every one of these asks for something other than what we get
          pubKeyCredParams: [{ type: 'public-key', alg: -257 }], // RS256
          authenticatorSelection: {
            authenticatorAttachment: 'cross-platform',
            userVerification: 'discouraged',
          },
        },
      });

      return {
        attachment: credential.authenticatorAttachment,
        transports: credential.response.getTransports(),
        algorithm: credential.response.getPublicKeyAlgorithm(),
        // Byte 32 of authenticator data holds the flags, after the rpId hash
        flags: new Uint8Array(credential.response.getAuthenticatorData())[32],
      };
    });

    expect(created.attachment).toBe('platform');
    expect(created.transports).toEqual(['internal']);
    expect(created.algorithm).toBe(-7); // ES256

    const USER_PRESENT = 0x01;
    const USER_VERIFIED = 0x04;
    expect(created.flags & USER_PRESENT).toBe(USER_PRESENT);
    expect(created.flags & USER_VERIFIED).toBe(USER_VERIFIED);
  });

  //
  //  A ceremony only fails when the request cannot be met. Asking for a
  //  passkey the authenticator does not have gives the same NotAllowedError
  //  as a user cancelling. Registering a passkey listed in excludeCredentials
  //  gives an InvalidStateError.
  //

  test('Step 5b: Logging in without a passkey fails like a cancellation', async ({
    context,
    page,
  }) => {
    await context.credentials.install();

    await submitLogin(page);

    await expect(message(page)).toHaveText(
      'Authentication was cancelled.',
    );
    await expect(page).toHaveURL(/#\/login$/);
  });


  // =====================================================================
  //  REFERENCE: The whole API
  // =====================================================================
  //
  //  context.credentials.install()          — Start intercepting WebAuthn
  //  context.credentials.create(rpId, opts) — Seed a passkey
  //  context.credentials.get(filter)        — Read passkeys, including keys
  //  context.credentials.delete(id)         — Remove a passkey
  //  context.storageState({ credentials: true }) — Save passkeys to a state
  //  browser.newContext({ storageState })   — Restore them and install
  //
  // =====================================================================
});
