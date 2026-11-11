import { test as base, type CDPSession, type Page } from '@playwright/test';

// ─── Types ──────────────────────────────────────────────────────────

export interface VirtualAuthenticator {
  /** The ID assigned by CDP to this virtual authenticator */
  authenticatorId: string;
  /** The raw CDP session — for advanced operations */
  cdpSession: CDPSession;
  /** Get all credentials stored on this authenticator */
  getCredentials: () => Promise<VirtualCredential[]>;
  /** Put a credential on this authenticator without a ceremony */
  addCredential: (credential: VirtualCredential) => Promise<void>;
  /** Remove a specific credential */
  removeCredential: (credentialId: string) => Promise<void>;
  /** Clear all credentials from this authenticator */
  clearCredentials: () => Promise<void>;
  /** Let user verification succeed or fail from now on */
  setUserVerified: (isUserVerified: boolean) => Promise<void>;
  /**
   * Whether the authenticator answers ceremonies on its own ("the user
   * touches it"). Switch it off to leave a ceremony to another authenticator.
   */
  setAutomaticPresence: (enabled: boolean) => Promise<void>;
  /** Remove this authenticator from the browser */
  remove: () => Promise<void>;
}

export interface VirtualCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId: string;
  /** PKCS#8, base64. Treat it as a secret. */
  privateKey: string;
  userHandle?: string;
  signCount: number;
}

// ─── Authenticator Options ──────────────────────────────────────────

export interface AuthenticatorOptions {
  /** Protocol version: 'ctap2' for passkeys (default) or 'u2f' for legacy */
  protocol?: 'ctap2' | 'u2f';
  /** Transport: 'internal' = platform (TouchID, FaceID), 'usb'/'ble'/'nfc' */
  transport?: 'internal' | 'usb' | 'ble' | 'nfc';
  /** Support discoverable credentials (passkeys). Default: true */
  hasResidentKey?: boolean;
  /** Support user verification (biometrics). Default: true */
  hasUserVerification?: boolean;
  /** Automatically pass user verification. Default: true */
  isUserVerified?: boolean;
}

const DEFAULT_OPTIONS: Required<AuthenticatorOptions> = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
};

// ─── Helper: Create Authenticator ────────────────────────────────────

/**
 * Adds a virtual authenticator to the page.
 *
 * Pass the `cdpSession` of an existing authenticator to add a second one
 * next to it. Without it, a new CDP session is opened and WebAuthn enabled.
 */
async function createVirtualAuthenticator(
  page: Page,
  options: AuthenticatorOptions = {},
  existingSession?: CDPSession,
): Promise<VirtualAuthenticator> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let cdpSession = existingSession;
  if (!cdpSession) {
    // Create a CDP session from the page's browser context
    cdpSession = await page.context().newCDPSession(page);

    // Enable the WebAuthn domain in CDP
    await cdpSession.send('WebAuthn.enable', {
      enableUI: false, // Suppress browser's native WebAuthn UI
    });
  }
  const session = cdpSession;

  // Add a virtual authenticator with the specified options
  const { authenticatorId } = await session.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: opts.protocol,
        transport: opts.transport,
        hasResidentKey: opts.hasResidentKey,
        hasUserVerification: opts.hasUserVerification,
        isUserVerified: opts.isUserVerified,
        automaticPresenceSimulation: true,
      },
    },
  );

  return {
    authenticatorId,
    cdpSession: session,

    async getCredentials() {
      const result = await session.send('WebAuthn.getCredentials', {
        authenticatorId,
      });
      return result.credentials as VirtualCredential[];
    },

    async addCredential(credential: VirtualCredential) {
      await session.send('WebAuthn.addCredential', {
        authenticatorId,
        credential,
      });
    },

    async removeCredential(credentialId: string) {
      await session.send('WebAuthn.removeCredential', {
        authenticatorId,
        credentialId,
      });
    },

    async clearCredentials() {
      await session.send('WebAuthn.clearCredentials', {
        authenticatorId,
      });
    },

    async setUserVerified(isUserVerified: boolean) {
      await session.send('WebAuthn.setUserVerified', {
        authenticatorId,
        isUserVerified,
      });
    },

    async setAutomaticPresence(enabled: boolean) {
      await session.send('WebAuthn.setAutomaticPresenceSimulation', {
        authenticatorId,
        enabled,
      });
    },

    async remove() {
      await session.send('WebAuthn.removeVirtualAuthenticator', {
        authenticatorId,
      });
    },
  };
}

// ─── Fixture ────────────────────────────────────────────────────────

type WebAuthnFixtures = {
  /**
   * A pre-configured virtual WebAuthn authenticator.
   *
   * This simulates a platform authenticator (like TouchID/FaceID)
   * with auto-verification — no manual interaction needed.
   *
   * The authenticator is automatically cleaned up after each test,
   * also when the test fails.
   */
  authenticator: VirtualAuthenticator;
};

type WebAuthnOptions = {
  /**
   * Settings for the `authenticator` fixture. Change them for a file or a
   * describe block:
   *
   *   test.use({ authenticatorOptions: { isUserVerified: false } });
   */
  authenticatorOptions: AuthenticatorOptions;
};

export const test = base.extend<WebAuthnFixtures & WebAuthnOptions>({
  authenticatorOptions: [{}, { option: true }],

  authenticator: async ({ page, authenticatorOptions }, use) => {
    const authenticator = await createVirtualAuthenticator(
      page,
      authenticatorOptions,
    );

    // Hand the authenticator to the test
    await use(authenticator);

    // Cleanup: remove authenticator and disable WebAuthn domain
    await authenticator.remove();
    await authenticator.cdpSession.send('WebAuthn.disable');
  },
});

export { expect } from '@playwright/test';

// Also export the helper for tests that need custom authenticator configs
export { createVirtualAuthenticator };
