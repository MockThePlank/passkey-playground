import { test as base, type CDPSession, type Page } from '@playwright/test';

// ─── Types ──────────────────────────────────────────────────────────

export interface VirtualAuthenticator {
  /** The ID assigned by CDP to this virtual authenticator */
  authenticatorId: string;
  /** The raw CDP session — for advanced operations */
  cdpSession: CDPSession;
  /** Get all credentials stored on this authenticator */
  getCredentials: () => Promise<VirtualCredential[]>;
  /** Remove a specific credential */
  removeCredential: (credentialId: string) => Promise<void>;
  /** Clear all credentials from this authenticator */
  clearCredentials: () => Promise<void>;
}

export interface VirtualCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId: string;
  userHandle: string;
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

async function createVirtualAuthenticator(
  page: Page,
  options: AuthenticatorOptions = {},
): Promise<VirtualAuthenticator> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Create a CDP session from the page's browser context
  const cdpSession = await page.context().newCDPSession(page);

  // Enable the WebAuthn domain in CDP
  await cdpSession.send('WebAuthn.enable', {
    enableUI: false, // Suppress browser's native WebAuthn UI
  });

  // Add a virtual authenticator with the specified options
  const { authenticatorId } = await cdpSession.send(
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
    cdpSession,

    async getCredentials() {
      const result = await cdpSession.send('WebAuthn.getCredentials', {
        authenticatorId,
      });
      return result.credentials as VirtualCredential[];
    },

    async removeCredential(credentialId: string) {
      await cdpSession.send('WebAuthn.removeCredential', {
        authenticatorId,
        credentialId,
      });
    },

    async clearCredentials() {
      await cdpSession.send('WebAuthn.clearCredentials', {
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
   * The authenticator is automatically cleaned up after each test.
   */
  authenticator: VirtualAuthenticator;
};

export const test = base.extend<WebAuthnFixtures>({
  authenticator: async ({ page }, use) => {
    const authenticator = await createVirtualAuthenticator(page);

    // Hand the authenticator to the test
    await use(authenticator);

    // Cleanup: remove authenticator and disable WebAuthn domain
    await authenticator.cdpSession.send(
      'WebAuthn.removeVirtualAuthenticator',
      { authenticatorId: authenticator.authenticatorId },
    );
    await authenticator.cdpSession.send('WebAuthn.disable');
  },
});

export { expect } from '@playwright/test';

// Also export the helper for tests that need custom authenticator configs
export { createVirtualAuthenticator };
