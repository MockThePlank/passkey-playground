import type { Browser, Page } from 'vibium';

// ─── Route A: CDP Virtual Authenticator ─────────────────────────────
//
// Vibium speaks WebDriver BiDi, which has no WebAuthn commands. For Chrome
// there is a way around that: chromedriver adds two BiDi commands that
// carry Chrome DevTools Protocol (CDP) commands,
//
//   goog:cdp.getSession   — the CDP session of a page
//   goog:cdp.sendCommand  — send any CDP command through it
//
// and Vibium passes commands it does not know on to the browser. That
// opens the same WebAuthn.* commands the Playwright CDP demo uses.
//
// Two things to know before relying on it:
//   - Vibium has no documented method for raw commands. This file reaches
//     for `browser.client`, which the typings mark as private. A Vibium
//     update may move it.
//   - It is Chrome only. Firefox has no CDP.

export interface CdpCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId: string;
  /** PKCS#8, base64. Treat it as a secret. */
  privateKey: string;
  userHandle?: string;
  signCount: number;
}

export interface CdpAuthenticator {
  authenticatorId: string;
  getCredentials: () => Promise<CdpCredential[]>;
  addCredential: (credential: CdpCredential) => Promise<void>;
  setUserVerified: (isUserVerified: boolean) => Promise<void>;
  remove: () => Promise<void>;
}

type RawClient = {
  send<T>(method: string, params: Record<string, unknown>): Promise<T>;
};

/** Adds a platform authenticator (TouchID-style) to the page. */
export async function createCdpAuthenticator(
  browser: Browser,
  page: Page,
): Promise<CdpAuthenticator> {
  // The one private access this route depends on
  const client = (browser as unknown as { client: RawClient }).client;

  const { session } = await client.send<{ session: string }>(
    'goog:cdp.getSession',
    { context: page.id },
  );

  async function cdp<T = unknown>(method: string, params = {}): Promise<T> {
    const reply = await client.send<{ result: T }>('goog:cdp.sendCommand', {
      method,
      params,
      session,
    });
    return reply.result;
  }

  await cdp('WebAuthn.enable', { enableUI: false });

  const { authenticatorId } = await cdp<{ authenticatorId: string }>(
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

  return {
    authenticatorId,

    async getCredentials() {
      const result = await cdp<{ credentials: CdpCredential[] }>(
        'WebAuthn.getCredentials',
        { authenticatorId },
      );
      return result.credentials;
    },

    async addCredential(credential) {
      await cdp('WebAuthn.addCredential', { authenticatorId, credential });
    },

    async setUserVerified(isUserVerified) {
      await cdp('WebAuthn.setUserVerified', { authenticatorId, isUserVerified });
    },

    async remove() {
      await cdp('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    },
  };
}
