/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Vibium + CDP Demo — A Guided Tour                              ║
 * ║                                                                  ║
 * ║  The Vibium counterpart to e2e/tests/passkey-cdp-demo.spec.ts:   ║
 * ║  a virtual authenticator inside Chrome, driven through CDP.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Browser } from 'vibium';
import {
  expectMessage,
  expectRoute,
  loginViaUi,
  logout,
  registerViaUi,
  RP_ID,
  startBrowser,
  submitLogin,
  uniqueName,
} from '../support/app.js';
import { createCdpAuthenticator } from '../support/cdp-authenticator.js';

// =====================================================================
//  BACKGROUND: How does Vibium reach CDP?
// =====================================================================
//
//  Vibium is built on WebDriver BiDi, a W3C standard. BiDi has no
//  commands for WebAuthn, so Vibium has no passkey API of its own.
//
//  Chrome's driver extends BiDi with `goog:cdp.sendCommand`, which
//  carries any CDP command. Through it, the WebAuthn.* commands from the
//  Playwright CDP demo work here as well: the browser's own WebAuthn
//  stack runs, with a virtual authenticator in place of hardware.
//
//  The price: this is Chrome only, and it uses a part of Vibium that is
//  not public API. support/cdp-authenticator.ts has the details.
//
//  Each test opens its own browser context, which is Vibium's way to
//  get fresh cookies, as Playwright does for every test.
//
// =====================================================================

describe('Vibium + CDP Demo', () => {
  let browser: Browser;

  before(async () => {
    // Always Chrome, whatever VIBIUM_ENGINE says: Firefox has no CDP
    browser = await startBrowser('chrome');
  });

  after(async () => {
    await browser.stop();
  });

  // ===================================================================
  //  STEP 1: Registration, inspection, login
  // ===================================================================

  test('Step 1: Full passkey flow with credential inspection', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const authenticator = await createCdpAuthenticator(browser, page);

    const username = uniqueName('vibium-cdp');
    await registerViaUi(page, username);

    // WebAuthn.getCredentials: what the authenticator stored
    const [credential, ...others] = await authenticator.getCredentials();
    assert.equal(others.length, 0);
    assert.equal(credential.isResidentCredential, true);
    assert.equal(credential.rpId, RP_ID);
    // The CDP authenticator counts the registration itself as the first use
    assert.equal(credential.signCount, 1);

    await logout(page);
    await loginViaUi(page, username);

    // Every login raises the signature counter
    const [afterLogin] = await authenticator.getCredentials();
    assert.equal(afterLogin.signCount, 2);

    await context.close();
  });

  // ===================================================================
  //  STEP 2: Failing user verification
  // ===================================================================
  //
  //  WebAuthn.setUserVerified decides whether the biometric check
  //  matches. The software authenticator of the other demo cannot do
  //  this: its user verification always succeeds.
  //

  test('Step 2: Toggling user verification during a test', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const authenticator = await createCdpAuthenticator(browser, page);

    const username = uniqueName('vibium-uv');
    await registerViaUi(page, username);
    await logout(page);

    // The fingerprint no longer matches. The page cannot tell that from
    // a user cancelling, so the app shows its cancellation message.
    await authenticator.setUserVerified(false);
    await submitLogin(page);
    await expectMessage(page, 'Authentication was cancelled.');
    await expectRoute(page, 'login');

    // The failed attempt did not use the passkey
    const [unused] = await authenticator.getCredentials();
    assert.equal(unused.signCount, 1);

    // Second try with the right finger
    await authenticator.setUserVerified(true);
    await loginViaUi(page, username);

    await context.close();
  });

  // ===================================================================
  //  STEP 3: Seeding a passkey
  // ===================================================================
  //
  //  WebAuthn.addCredential puts a passkey on an authenticator without
  //  a ceremony, so a test can start at the login. The captured data
  //  contains the private key: keep it out of version control.
  //

  test('Step 3: A captured passkey logs in from a new context', async () => {
    const username = uniqueName('vibium-seed');

    // Capture: let the app register a passkey, then read it back
    const enrollContext = await browser.newContext();
    const enrollPage = await enrollContext.newPage();
    const enrollAuthenticator = await createCdpAuthenticator(browser, enrollPage);
    await registerViaUi(enrollPage, username);
    const [captured] = await enrollAuthenticator.getCredentials();
    await enrollContext.close();

    // Seed: this context never ran a registration ceremony
    const seededContext = await browser.newContext();
    const seededPage = await seededContext.newPage();
    const seededAuthenticator = await createCdpAuthenticator(browser, seededPage);
    await seededAuthenticator.addCredential(captured);
    await loginViaUi(seededPage, username);

    const [used] = await seededAuthenticator.getCredentials();
    assert.equal(used.credentialId, captured.credentialId);
    assert.equal(used.signCount, captured.signCount + 1);

    await seededContext.close();
  });
});
