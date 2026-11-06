# 🔑 Passkey Playground

A minimal demo app that shows how to **test WebAuthn/Passkey flows with Playwright**, using Chrome DevTools Protocol (CDP) virtual authenticators and Playwright's built-in `context.credentials` API.

## What This Project Demonstrates

- Implementing WebAuthn registration and login with `@simplewebauthn`
- Testing passkey flows in Playwright **without real hardware**
- Using CDP sessions to create virtual authenticators
- Inspecting credentials, sign counts, and authenticator state via CDP
- Configuring virtual authenticators (platform and USB) and simulating failed user verification
- Using `context.credentials` to register, seed and reuse passkeys without CDP

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla TypeScript, Vite |
| Backend | Fastify, `@simplewebauthn/server` |
| Database | PostgreSQL (Docker) |
| ORM | Drizzle |
| Testing | Playwright (CDP WebAuthn and `context.credentials`) |

## Quick Start

### Prerequisites

- Node.js ≥ 22
- Docker & Docker Compose

### Setup

```bash
# 1. Clone and install
git clone https://github.com/MockThePlank/passkey-playground.git
cd passkey-playground
npm install

# 2. Create the server config (the defaults match Docker Compose)
cp .env.example .env

# 3. Start PostgreSQL
npm run db:up

# 4. Run migrations
npm run db:migrate

# 5. Start dev servers (backend + frontend)
npm run dev
```

App runs at **http://localhost:5173**

### Run Tests

```bash
# Install Playwright browsers (first time only)
npx playwright install chromium webkit

# Run all tests
npm test

# Run with UI mode (great for debugging)
npm run test:ui

# Run headed (see the browser)
npm run test:headed -w e2e
```

## Project Structure

```
passkey-playground/
├── server/           # Fastify backend with WebAuthn endpoints
│   └── src/
│       ├── index.ts          # Server setup, including the session cookie
│       ├── routes/auth.ts    # Register + Login WebAuthn endpoints
│       ├── db/schema.ts      # Users + Credentials tables
│       └── lib/session.ts    # Session data types and auth guard
│
├── client/           # Vanilla TypeScript frontend
│   └── src/
│       ├── views/            # Register, Login, Dashboard views
│       ├── api.ts            # API client
│       └── main.ts           # Hash router
│
└── e2e/              # ⭐ Playwright tests (the main attraction)
    ├── fixtures/
    │   └── webauthn.fixture.ts   # Reusable CDP authenticator fixture
    └── tests/
        ├── passkey-register.spec.ts           # Registration tests
        ├── passkey-login.spec.ts              # Login tests
        ├── passkey-cdp-demo.spec.ts           # 📖 Commented guide: CDP
        └── passkey-credentials-demo.spec.ts   # 📖 Commented guide: context.credentials
```

## Key File: `passkey-cdp-demo.spec.ts`

This is the **core learning resource**. It walks through:

1. **Creating a CDP session** — How to get low-level browser access
2. **Adding virtual authenticators** — Configuration options explained
3. **Full registration + login flow** — End-to-end with credential inspection
4. **Multiple authenticators** — Simulating platform + USB scenarios
5. **User verification failure** — Testing edge cases

## Key File: `passkey-credentials-demo.spec.ts`

The counterpart to the CDP demo, using Playwright's built-in API:

1. **`install()` and `get()`** — Register a passkey and read it back
2. **Login** — Watch the signature counter go up
3. **`create()`** — Seed passkeys, and see what the server does with unknown keys and old counters
4. **Storage state** — Reuse a session and its passkey in a new context
5. **Limits** — What this API cannot simulate

## CDP or `context.credentials`?

| | CDP (`WebAuthn.*`) | `context.credentials` |
|---|---|---|
| **Browsers** | Chromium only | All browsers according to the [release notes](https://playwright.dev/docs/release-notes); tested here in Chromium and WebKit |
| **How it works** | Virtual authenticator inside the browser, so its WebAuthn stack runs | Script replaces `navigator.credentials.create()` and `.get()`; keys live in the Playwright process |
| **Setup** | CDP session, `WebAuthn.enable`, `addVirtualAuthenticator` | `context.credentials.install()` |
| **User verification** | Configurable, including failure (`isUserVerified: false`) | Always succeeds |
| **Transports** | `internal`, `usb`, `ble`, `nfc` | Always `internal`, attachment `platform` |
| **Several authenticators** | Yes | No, one per context |
| **Seeding passkeys** | `WebAuthn.addCredential` | `create()` |
| **Reuse across tests** | Build it yourself | `storageState({ credentials: true })` |
| **`signCount` after registration** | 1 | 0 |

**Use `context.credentials`** for most passkey tests: login flows, seeded users and anything that should also run outside Chromium.

**Use CDP** when the authenticator itself is what you test: failed user verification, specific transports, several authenticators, or the browser's own WebAuthn behaviour.

The [`Credentials` docs](https://playwright.dev/docs/api/class-credentials) say nothing about user verification or transports. Those two rows come from the source of Playwright 1.64, and Step 5a of the demo fails if the behaviour changes.

## How CDP WebAuthn Works

```
┌──────────────┐    navigator.credentials.create()     ┌──────────────────┐
│              │──────────────────────────────────────▶│                  │
│   Your App   │                                       │  Virtual         │
│   (Browser)  │    Intercepted by CDP                 │  Authenticator   │
│              │◀──────────────────────────────────────│  (No hardware!)  │
└──────────────┘    Returns signed attestation         └──────────────────┘
                                                              │
                                                              │ Managed via
                                                              │ CDP Session
                                                              │
                                                       ┌──────────────────┐
                                                       │  Playwright Test │
                                                       │  (Your test code)│
                                                       └──────────────────┘
```

## CDP WebAuthn Commands Reference

| Command | Purpose |
|---------|---------|
| `WebAuthn.enable` | Start intercepting WebAuthn API calls |
| `WebAuthn.disable` | Stop intercepting |
| `WebAuthn.addVirtualAuthenticator` | Create a virtual authenticator |
| `WebAuthn.removeVirtualAuthenticator` | Remove one |
| `WebAuthn.getCredentials` | List stored credentials |
| `WebAuthn.addCredential` | Manually inject a credential |
| `WebAuthn.removeCredential` | Remove a specific credential |
| `WebAuthn.clearCredentials` | Wipe all credentials |
| `WebAuthn.setUserVerified` | Toggle user verification at runtime |
| `WebAuthn.setAutomaticPresenceSimulation` | Toggle automatic user presence |

## Important Notes

- **Chromium only applies to CDP**: CDP WebAuthn is not available in Firefox or WebKit, so those specs run in Chromium only. `context.credentials` has no such limit.
- **Firefox is not part of the test run**: Playwright's Firefox 157 build exits during startup on the macOS 27 machine this was developed on, with `Could not find profile folder`. It also happens when starting the binary directly, without Playwright. The cause is unknown, so whether the demo passes in Firefox is untested.
- **localhost**: WebAuthn requires a secure context. `localhost` is treated as secure.
- Tests run sequentially (`workers: 1`, set in `e2e/playwright.config.ts`)
