import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from 'vibium';

// ─── Route B: Software Authenticator ────────────────────────────────
//
// The same idea as Playwright's context.credentials, built by hand: an
// init script replaces navigator.credentials.create() and .get() before
// the page loads. The replacement generates real ES256 keys with WebCrypto
// and returns real attestations and signatures, so the server verifies
// them as usual.
//
// It needs nothing but context.addInitScript() and page.evaluate(), both
// public Vibium API, and no CDP. That is why it is not tied to Chrome.
//
// What it does not do:
//   - It never tests the browser's own WebAuthn stack. The page still has
//     to find window.PublicKeyCredential, which this script does not add.
//   - User verification always succeeds, the transport is always
//     'internal', the algorithm always ES256 with 'none' attestation.
//   - The private keys sit in the page's localStorage, where the app could
//     read them. Fine for a test, and a reason never to seed real keys.
//
// The script itself is in soft-authenticator.page.js.

export interface SoftPasskey {
  /** Credential ID, base64url */
  id: string;
  rpId: string;
  /** base64url */
  userHandle: string;
  /** PKCS#8, base64url. Treat it as a secret. */
  privateKey: string;
  signCount: number;
}

const pageScript = readFileSync(
  new URL('./soft-authenticator.page.js', import.meta.url),
  'utf8',
);

/**
 * Installs the authenticator for every page of the context. Call it before
 * opening a page. `seed` puts passkeys on it without a ceremony.
 */
export async function installSoftAuthenticator(
  context: BrowserContext,
  seed: SoftPasskey[] = [],
) {
  await context.addInitScript(`(${pageScript})(${JSON.stringify(seed)});`);
}

/** Everything the authenticator holds, including the private keys. */
export function getPasskeys(page: Page): Promise<SoftPasskey[]> {
  return page.evaluate<SoftPasskey[]>('window.__softAuthenticator.list()');
}
