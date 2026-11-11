// This function runs inside the page, before any of the page's own scripts.
// soft-authenticator.ts reads this file as text and installs it as an init
// script, so it must stay self-contained plain JavaScript.
(seed) => {
  const STORAGE_KEY = '__soft_authenticator__';
  const encoder = new TextEncoder();

  // ─── Bytes ────────────────────────────────────────────────────────
  const bytes = (v) =>
    v instanceof ArrayBuffer
      ? new Uint8Array(v)
      : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };
  const toBase64Url = (b) =>
    btoa(String.fromCharCode(...b))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const fromBase64Url = (s) =>
    Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
      c.charCodeAt(0),
    );
  const sha256 = async (b) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', b));
  const uint32 = (n) => new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n]);

  // WebCrypto signs as r || s (64 bytes); WebAuthn wants ASN.1 DER
  const derInteger = (b) => {
    let start = 0;
    while (start < b.length - 1 && b[start] === 0) start++;
    b = b.slice(start);
    if (b[0] & 0x80) b = concat(new Uint8Array([0]), b);
    return concat(new Uint8Array([0x02, b.length]), b);
  };
  const toDer = (raw) => {
    const r = derInteger(raw.slice(0, 32));
    const s = derInteger(raw.slice(32));
    return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
  };

  // ─── Passkey Store ────────────────────────────────────────────────
  //
  // Kept in localStorage so that passkeys survive a reload. Loaded on first
  // use, because an init script also runs on about:blank, which has no
  // storage. A new browser context starts empty and takes the seed.
  let passkeys = null;
  const all = () => {
    if (!passkeys) {
      let saved = null;
      try {
        saved = localStorage.getItem(STORAGE_KEY);
      } catch {}
      passkeys = saved ? JSON.parse(saved) : structuredClone(seed);
    }
    return passkeys;
  };
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(passkeys));
    } catch {}
  };

  const clientData = (type, challenge) =>
    encoder.encode(
      JSON.stringify({
        type,
        challenge: toBase64Url(bytes(challenge)),
        origin: location.origin,
        crossOrigin: false,
      }),
    );

  // Authenticator data flags
  const USER_PRESENT = 0x01;
  const USER_VERIFIED = 0x04;
  const ATTESTED_CREDENTIAL_DATA = 0x40;

  // ─── navigator.credentials.create() ───────────────────────────────
  CredentialsContainer.prototype.create = async function ({ publicKey }) {
    const excluded = (publicKey.excludeCredentials ?? []).map((c) =>
      toBase64Url(bytes(c.id)),
    );
    if (all().some((p) => excluded.includes(p.id))) {
      throw new DOMException('Passkey already registered', 'InvalidStateError');
    }

    const keys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
    const credentialId = crypto.getRandomValues(new Uint8Array(16));

    // COSE key, CBOR by hand: {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
    const coseKey = concat(
      new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 32]),
      fromBase64Url(jwk.x),
      new Uint8Array([0x22, 0x58, 32]),
      fromBase64Url(jwk.y),
    );

    const authenticatorData = concat(
      await sha256(encoder.encode(publicKey.rp.id)),
      new Uint8Array([USER_PRESENT | USER_VERIFIED | ATTESTED_CREDENTIAL_DATA]),
      uint32(0), // signature counter
      new Uint8Array(16), // AAGUID: all zero, an unnamed authenticator
      new Uint8Array([0, credentialId.length]),
      credentialId,
      coseKey,
    );

    // CBOR: {"fmt": "none", "attStmt": {}, "authData": <bytes>}
    const attestationObject = concat(
      new Uint8Array([0xa3, 0x63]),
      encoder.encode('fmt'),
      new Uint8Array([0x64]),
      encoder.encode('none'),
      new Uint8Array([0x67]),
      encoder.encode('attStmt'),
      new Uint8Array([0xa0, 0x68]),
      encoder.encode('authData'),
      new Uint8Array([0x58, authenticatorData.length]),
      authenticatorData,
    );

    all().push({
      id: toBase64Url(credentialId),
      rpId: publicKey.rp.id,
      userHandle: toBase64Url(bytes(publicKey.user.id)),
      privateKey: toBase64Url(new Uint8Array(pkcs8)),
      signCount: 0,
    });
    save();

    return {
      id: toBase64Url(credentialId),
      rawId: credentialId.buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        attestationObject: attestationObject.buffer,
        clientDataJSON: clientData('webauthn.create', publicKey.challenge)
          .buffer,
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({}),
    };
  };

  // ─── navigator.credentials.get() ──────────────────────────────────
  CredentialsContainer.prototype.get = async function ({ publicKey }) {
    const allowed = (publicKey.allowCredentials ?? []).map((c) =>
      toBase64Url(bytes(c.id)),
    );
    const passkey = all().find(
      (p) =>
        p.rpId === publicKey.rpId &&
        (allowed.length === 0 || allowed.includes(p.id)),
    );
    if (!passkey) {
      // What a browser reports when the user has no passkey or cancels
      throw new DOMException('No passkey for this site', 'NotAllowedError');
    }

    passkey.signCount += 1;
    save();

    const authenticatorData = concat(
      await sha256(encoder.encode(publicKey.rpId)),
      new Uint8Array([USER_PRESENT | USER_VERIFIED]),
      uint32(passkey.signCount),
    );
    const clientDataJSON = clientData('webauthn.get', publicKey.challenge);

    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      fromBase64Url(passkey.privateKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      concat(authenticatorData, await sha256(clientDataJSON)),
    );

    return {
      id: passkey.id,
      rawId: fromBase64Url(passkey.id).buffer,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        authenticatorData: authenticatorData.buffer,
        clientDataJSON: clientDataJSON.buffer,
        signature: toDer(new Uint8Array(signature)).buffer,
        userHandle: fromBase64Url(passkey.userHandle).buffer,
      },
      getClientExtensionResults: () => ({}),
    };
  };

  // For the test: read what the authenticator holds
  window.__softAuthenticator = { list: () => all() };
}
