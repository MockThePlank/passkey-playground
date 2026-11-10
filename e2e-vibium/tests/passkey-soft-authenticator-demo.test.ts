/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Vibium + Software Authenticator Demo — A Guided Tour           ║
 * ║                                                                  ║
 * ║  The Vibium counterpart to                                       ║
 * ║  e2e/tests/passkey-credentials-demo.spec.ts: passkeys without    ║
 * ║  CDP, by replacing navigator.credentials in the page.            ║
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
import {
  getPasskeys,
  installSoftAuthenticator,
} from '../support/soft-authenticator.js';

// =====================================================================
//  BACKGROUND: A passkey API of our own
// =====================================================================
//
//  Playwright ships context.credentials. Vibium has nothing like it, but
//  it has the one building block that API is made of: an init script that
//  runs before the page's own code.
//
//  support/soft-authenticator.page.js is such a script. It replaces
//  navigator.credentials.create() and .get() with an authenticator
//  written in about 200 lines of JavaScript. The keys and signatures are
//  real, so the server does its full job.
//
//  Unlike the CDP route this uses public Vibium API only, and nothing in
//  it is specific to Chrome. Set VIBIUM_ENGINE=firefox to try it there;
//  this project has only run it in Chrome.
//
//  installSoftAuthenticator() must be called before the context opens a
//  page, like context.credentials.install() in Playwright.
//
// =====================================================================

describe('Vibium + Software Authenticator Demo', () => {
  let browser: Browser;

  before(async () => {
    browser = await startBrowser();
  });

  after(async () => {
    await browser.stop();
  });

  // ===================================================================
  //  STEP 1: Registering and reading back
  // ===================================================================

  test('Step 1: Registering a passkey and reading it back', async () => {
    const context = await browser.newContext();
    await installSoftAuthenticator(context);
    const page = await context.newPage();

    await registerViaUi(page, uniqueName('vibium-soft'));

    const passkeys = await getPasskeys(page);
    assert.equal(passkeys.length, 1);
    assert.equal(passkeys[0].rpId, RP_ID);
    assert.ok(passkeys[0].userHandle);
    assert.ok(passkeys[0].privateKey);
    // Like context.credentials, and unlike CDP, counting starts at 0
    assert.equal(passkeys[0].signCount, 0);

    await context.close();
  });

  // ===================================================================
  //  STEP 2: Login
  // ===================================================================

  test('Step 2: Logging in raises the signature counter', async () => {
    const context = await browser.newContext();
    await installSoftAuthenticator(context);
    const page = await context.newPage();

    const username = uniqueName('vibium-soft-login');
    await registerViaUi(page, username);
    await logout(page);
    await loginViaUi(page, username);

    const [passkey] = await getPasskeys(page);
    assert.equal(passkey.signCount, 1);

    // The passkey survives a reload, because the store is in localStorage
    await page.reload();
    await logout(page);
    await loginViaUi(page, username);
    assert.equal((await getPasskeys(page))[0].signCount, 2);

    await context.close();
  });

  // ===================================================================
  //  STEP 3: Seeding
  // ===================================================================
  //
  //  A passkey the server already knows lets a test start at the login.
  //  The second argument of installSoftAuthenticator() seeds it.
  //

  test('Step 3a: A captured passkey logs in from a new context', async () => {
    const username = uniqueName('vibium-soft-seed');

    // Capture: let the app register a passkey, then read it back
    const enrollContext = await browser.newContext();
    await installSoftAuthenticator(enrollContext);
    const enrollPage = await enrollContext.newPage();
    await registerViaUi(enrollPage, username);
    const captured = await getPasskeys(enrollPage);
    await enrollContext.close();

    // Seed: this context never ran a registration ceremony
    const seededContext = await browser.newContext();
    await installSoftAuthenticator(seededContext, captured);
    const seededPage = await seededContext.newPage();
    await loginViaUi(seededPage, username);

    const [used] = await getPasskeys(seededPage);
    assert.equal(used.id, captured[0].id);
    assert.equal(used.signCount, captured[0].signCount + 1);

    await seededContext.close();
  });

  test('Step 3b: A stale signature counter looks like a cloned key', async () => {
    const username = uniqueName('vibium-soft-counter');

    const original = await browser.newContext();
    await installSoftAuthenticator(original);
    const originalPage = await original.newPage();
    await registerViaUi(originalPage, username);
    const atEnrollment = await getPasskeys(originalPage);

    // This login moves the counter stored on the server to 1
    await logout(originalPage);
    await loginViaUi(originalPage, username);
    await original.close();

    // Re-seeding the old snapshot reports 1 again, which is not an increase
    const stale = await browser.newContext();
    await installSoftAuthenticator(stale, atEnrollment);
    const stalePage = await stale.newPage();
    await submitLogin(stalePage);
    await expectMessage(stalePage, 'Verification failed');
    await stale.close();

    // Continuing from the counter the server has seen works
    const current = await browser.newContext();
    await installSoftAuthenticator(current, [
      { ...atEnrollment[0], signCount: 1 },
    ]);
    await loginViaUi(await current.newPage(), username);
    await current.close();
  });

  // ===================================================================
  //  STEP 4: No passkey
  // ===================================================================
  //
  //  The authenticator answers a login without a matching passkey with a
  //  NotAllowedError, as a browser does when the user has none or cancels.
  //

  test('Step 4: Logging in without a passkey fails like a cancellation', async () => {
    const context = await browser.newContext();
    await installSoftAuthenticator(context);
    const page = await context.newPage();

    await submitLogin(page);
    await expectMessage(page, 'Authentication was cancelled.');
    await expectRoute(page, 'login');

    await context.close();
  });
});
