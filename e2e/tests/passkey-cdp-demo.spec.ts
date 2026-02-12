/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CDP WebAuthn Demo — A Guided Tour                              ║
 * ║                                                                  ║
 * ║  This file is the core learning resource of this project.        ║
 * ║  It explains step-by-step how to use Chrome DevTools Protocol    ║
 * ║  (CDP) to test WebAuthn/Passkey flows with Playwright.           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { test as base, expect, type CDPSession } from '@playwright/test';

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
// =====================================================================


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
//  with Chromium-based browsers.
//

base.describe('CDP WebAuthn Demo', () => {

  base('Step 1: Creating a CDP session and enabling WebAuthn', async ({ page }) => {
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

    // At this point, WebAuthn is intercepted, but we have no
    // authenticators yet. Any WebAuthn API call will fail with
    // "NotAllowedError" because there's nothing to handle it.

    // ───────────────────────────────────────────────────────────────
    //  Cleanup: Always disable when done.
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

  base('Step 2: Adding and inspecting a virtual authenticator', async ({ page }) => {
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

    // authenticatorId is a string like "1" — CDP's reference to
    // this specific authenticator instance.
    expect(authenticatorId).toBeTruthy();
    console.log('Virtual Authenticator ID:', authenticatorId);

    // ───────────────────────────────────────────────────────────────
    //  At this point, any WebAuthn ceremony on this page will be
    //  handled by our virtual authenticator automatically.
    //  No user interaction needed.
    // ───────────────────────────────────────────────────────────────

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
  //  Now we put it all together: enable WebAuthn, create an authenticator,
  //  register a passkey, inspect the stored credential, then login.
  //

  base('Step 3: Full passkey flow with credential inspection', async ({ page }) => {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('WebAuthn.enable', { enableUI: false });

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

    // ───────────────────────────────────────────────────────────────
    //  3a. Register a passkey
    // ───────────────────────────────────────────────────────────────
    await page.goto('/#/register');
    await page.fill('#username', 'demo-user');
    await page.click('#register-btn');
    await page.waitForURL('**/dashboard');

    // ───────────────────────────────────────────────────────────────
    //  3b. Inspect credentials via CDP
    //
    //  WebAuthn.getCredentials returns all credentials stored on
    //  the virtual authenticator. This is incredibly useful for
    //  verifying that registration actually worked at the
    //  authenticator level (not just the UI level).
    // ───────────────────────────────────────────────────────────────
    const { credentials } = await cdpSession.send('WebAuthn.getCredentials', {
      authenticatorId,
    });

    console.log('Stored credentials:', JSON.stringify(credentials, null, 2));

    expect(credentials).toHaveLength(1);

    const cred = credentials[0];
    expect(cred.isResidentCredential).toBe(true);
    expect(cred.rpId).toBe('localhost');
    // userHandle is the base64-encoded user ID from the server
    expect(cred.userHandle).toBeTruthy();
    // signCount starts at 1 after registration
    expect(cred.signCount).toBeGreaterThanOrEqual(1);

    // ───────────────────────────────────────────────────────────────
    //  3c. Logout and Login
    // ───────────────────────────────────────────────────────────────
    await page.click('#logout-btn');
    await page.waitForURL('**/login');

    await page.click('#login-btn');
    await page.waitForURL('**/dashboard');

    // ───────────────────────────────────────────────────────────────
    //  3d. Verify signCount incremented after login
    //
    //  The signature counter is a security mechanism. It increments
    //  on every use. If a server ever receives a counter value
    //  that is lower than the stored one, it knows the credential
    //  may have been cloned.
    // ───────────────────────────────────────────────────────────────
    const { credentials: afterLogin } = await cdpSession.send(
      'WebAuthn.getCredentials',
      { authenticatorId },
    );

    expect(afterLogin[0].signCount).toBeGreaterThan(cred.signCount);
    console.log(
      `Sign count: ${cred.signCount} → ${afterLogin[0].signCount}`,
    );

    // Cleanup
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId,
    });
    await cdpSession.send('WebAuthn.disable');
  });


  // =====================================================================
  //  STEP 4: Advanced — Multiple Authenticators
  // =====================================================================
  //
  //  You can add multiple virtual authenticators to simulate
  //  scenarios like:
  //    - User has a platform authenticator AND a USB key
  //    - Testing authenticator selection prompts
  //    - Cross-device authentication flows
  //

  base('Step 4: Multiple authenticators', async ({ page }) => {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('WebAuthn.enable', { enableUI: false });

    // Platform authenticator (TouchID-style)
    const { authenticatorId: platformId } = await cdpSession.send(
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

    // USB security key (like YubiKey)
    const { authenticatorId: usbId } = await cdpSession.send(
      'WebAuthn.addVirtualAuthenticator',
      {
        options: {
          protocol: 'ctap2',
          transport: 'usb',
          hasResidentKey: true,
          hasUserVerification: false, // USB keys often don't have biometrics
          isUserVerified: false,
          automaticPresenceSimulation: true,
        },
      },
    );

    console.log('Platform authenticator:', platformId);
    console.log('USB authenticator:', usbId);

    // Both authenticators are now active.
    // The browser will prefer the platform authenticator for
    // passkey ceremonies (transport: 'internal').

    // Cleanup
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: platformId,
    });
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: usbId,
    });
    await cdpSession.send('WebAuthn.disable');
  });


  // =====================================================================
  //  STEP 5: Simulating User Verification Failure
  // =====================================================================
  //
  //  By setting isUserVerified: false, you can test how your app
  //  handles the case where biometric verification fails.
  //

  base('Step 5: User verification failure scenario', async ({ page }) => {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('WebAuthn.enable', { enableUI: false });

    // Authenticator where user verification FAILS
    const { authenticatorId } = await cdpSession.send(
      'WebAuthn.addVirtualAuthenticator',
      {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: false, // ← This is the key difference
          automaticPresenceSimulation: true,
        },
      },
    );

    await page.goto('/#/register');
    await page.fill('#username', 'uv-fail-test');
    await page.click('#register-btn');

    // The registration should fail or the server should reject it,
    // depending on whether userVerification is 'required' or 'preferred'.
    // With 'preferred', the ceremony may succeed but with UV=false.
    // With 'required', it will fail.

    // Wait briefly for the response
    await page.waitForTimeout(2000);

    // Check if we're still on the register page (failure) or redirected
    const url = page.url();
    console.log('URL after UV failure attempt:', url);

    // Cleanup
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId,
    });
    await cdpSession.send('WebAuthn.disable');
  });


  // =====================================================================
  //  REFERENCE: All CDP WebAuthn Commands
  // =====================================================================
  //
  //  WebAuthn.enable              — Start intercepting WebAuthn calls
  //  WebAuthn.disable             — Stop intercepting
  //  WebAuthn.addVirtualAuthenticator   — Create a virtual authenticator
  //  WebAuthn.removeVirtualAuthenticator — Remove one
  //  WebAuthn.getCredentials      — List all credentials on an authenticator
  //  WebAuthn.addCredential       — Manually add a credential
  //  WebAuthn.removeCredential    — Remove a specific credential
  //  WebAuthn.clearCredentials    — Remove all credentials
  //  WebAuthn.setUserVerified     — Toggle UV at runtime
  //  WebAuthn.setAutomaticPresenceSimulation — Toggle auto-presence
  //
  // =====================================================================
});
