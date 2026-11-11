import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

// ─── Raw Ceremonies ─────────────────────────────────────────────────
//
// The app's own buttons always send the server an honest response. To see
// what the server does with a dishonest one, a test has to stand between
// the browser and the server. These helpers run a ceremony in three steps
// the test controls:
//
//   1. ask the server for options     (and change them, if you like)
//   2. let the authenticator answer   (the browser's real WebAuthn stack)
//   3. send the answer to the server  (after changing it, if you like)
//
// Steps 1 and 2 run in the page, so the session cookie that carries the
// challenge is the page's own. Step 3 uses page.request, which shares that
// cookie.
//
// The JSON conversions (parse...FromJSON, toJSON) are built into Chromium.

/** A WebAuthn response as the browser serialises it. */
export interface CeremonyResponse {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    /** Login responses only */
    signature?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

type Overrides = {
  /** Ask the authenticator for something else than the server asked for */
  userVerification?: 'required' | 'preferred' | 'discouraged';
  /** Registration only: whether the passkey must be discoverable */
  residentKey?: 'required' | 'preferred' | 'discouraged';
};

// e2e/tsconfig.json has no DOM lib, so the page-side code describes the
// little of the browser's WebAuthn API it uses
type WebAuthnPage = {
  navigator: {
    credentials: {
      create(options: unknown): Promise<{ toJSON(): CeremonyResponse }>;
      get(options: unknown): Promise<{ toJSON(): CeremonyResponse }>;
    };
  };
  PublicKeyCredential: {
    parseCreationOptionsFromJSON(json: unknown): unknown;
    parseRequestOptionsFromJSON(json: unknown): unknown;
  };
};

/** Steps 1 and 2 of a registration. Nothing is sent back to the server. */
export function createRegistration(
  page: Page,
  username: string,
  overrides: Overrides = {},
): Promise<CeremonyResponse> {
  return page.evaluate(
    async ({ username, overrides }) => {
      const { navigator, PublicKeyCredential } =
        globalThis as unknown as WebAuthnPage;

      const res = await fetch('/api/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!res.ok) throw new Error(`options: ${res.status}`);
      const options = (await res.json()) as {
        authenticatorSelection: Record<string, unknown>;
      };
      if (overrides.userVerification) {
        options.authenticatorSelection.userVerification =
          overrides.userVerification;
      }
      if (overrides.residentKey) {
        options.authenticatorSelection.residentKey = overrides.residentKey;
        options.authenticatorSelection.requireResidentKey =
          overrides.residentKey === 'required';
      }

      const credential = await navigator.credentials.create({
        publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
      });
      return credential.toJSON();
    },
    { username, overrides },
  );
}

/** Steps 1 and 2 of a login. Nothing is sent back to the server. */
export function createAuthentication(
  page: Page,
  overrides: Pick<Overrides, 'userVerification'> = {},
): Promise<CeremonyResponse> {
  return page.evaluate(async (overrides) => {
    const { navigator, PublicKeyCredential } =
      globalThis as unknown as WebAuthnPage;

    const res = await fetch('/api/auth/login/options', { method: 'POST' });
    if (!res.ok) throw new Error(`options: ${res.status}`);
    const options = (await res.json()) as Record<string, unknown>;
    if (overrides.userVerification) {
      options.userVerification = overrides.userVerification;
    }

    const credential = await navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
    });
    return credential.toJSON();
  }, overrides);
}

/** Step 3: sends a response to the server and returns its verdict. */
export async function verify(
  page: Page,
  ceremony: 'register' | 'login',
  response: CeremonyResponse,
) {
  const res = await page.request.post(`/api/auth/${ceremony}/verify`, {
    data: response,
  });
  return { status: res.status(), body: await res.json() };
}

// ─── Tampering ──────────────────────────────────────────────────────

const decode = (value: string) => Buffer.from(value, 'base64url');
const encode = (bytes: Buffer) => bytes.toString('base64url');

/**
 * Rewrites a field of clientDataJSON, the part of a response in which the
 * browser states the challenge it answered and the origin it ran on.
 */
export function withClientData(
  response: CeremonyResponse,
  change: Partial<{ challenge: string; origin: string; type: string }>,
): CeremonyResponse {
  const clientData = JSON.parse(
    decode(response.response.clientDataJSON).toString('utf8'),
  );
  const clientDataJSON = encode(
    Buffer.from(JSON.stringify({ ...clientData, ...change }), 'utf8'),
  );
  return { ...response, response: { ...response.response, clientDataJSON } };
}

/**
 * Makes a registration response claim it was created for another relying
 * party. The authenticator data starts with the SHA-256 hash of the RP ID;
 * this swaps that hash inside the attestation object, which nothing signs
 * in a registration without attestation.
 */
export function withRelyingParty(
  response: CeremonyResponse,
  from: string,
  to: string,
): CeremonyResponse {
  const hash = (rpId: string) => createHash('sha256').update(rpId).digest();
  const attestationObject = decode(String(response.response.attestationObject));
  const at = attestationObject.indexOf(hash(from));
  if (at < 0) throw new Error(`No RP ID hash of ${from} in the response`);
  hash(to).copy(attestationObject, at);

  return {
    ...response,
    response: {
      ...response.response,
      attestationObject: encode(attestationObject),
    },
  };
}

/** Flips one bit in the middle of the signature of a login response. */
export function withBrokenSignature(
  response: CeremonyResponse,
): CeremonyResponse {
  if (!response.response.signature) {
    throw new Error('Only a login response has a signature');
  }
  const signature = decode(response.response.signature);
  signature[signature.length >> 1] ^= 0x01;
  return {
    ...response,
    response: { ...response.response, signature: encode(signature) },
  };
}
