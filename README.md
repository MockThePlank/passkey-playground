# 🔑 Passkey Playground

A minimal demo app that shows how to **test WebAuthn/Passkey flows with Playwright**, using Chrome DevTools Protocol (CDP) virtual authenticators and Playwright's built-in `context.credentials` API. A second, smaller suite does the same with **[Vibium](https://github.com/VibiumDev/vibium)**, which has no passkey API of its own.

## What This Project Demonstrates

- Implementing WebAuthn registration and login with `@simplewebauthn`
- Testing passkey flows in Playwright **without real hardware**
- Using CDP sessions to create virtual authenticators
- Inspecting credentials, sign counts, and authenticator state via CDP
- Configuring virtual authenticators (platform and USB), choosing which one answers, and simulating failed user verification
- Seeding a known passkey with CDP (`WebAuthn.addCredential`) so a test can start at the login
- Using `context.credentials` to register, seed and reuse passkeys without CDP
- Doing both with Vibium: CDP through WebDriver BiDi, and a software authenticator installed as an init script

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla TypeScript, Vite |
| Backend | Fastify, `@simplewebauthn/server` |
| Database | PostgreSQL (Docker) |
| ORM | Drizzle |
| Testing | Playwright (CDP WebAuthn and `context.credentials`), Vibium with Node's test runner |

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

# Run a single test file
npm test -w e2e -- tests/passkey-register.spec.ts

# Typecheck all packages
npm run typecheck
```

### Run the Vibium Tests

```bash
# Install Chrome for Testing (first time only)
npx vibium install

# Run the Vibium suite
npm run test:vibium

# Run headed (see the browser)
npm run test:headed -w e2e-vibium

# Run a single step
npm test -w e2e-vibium -- --test-name-pattern "Step 2"
```

`npx vibium install` is needed because this repository does not run install scripts of dependencies (`allowScripts` in `package.json`), and Vibium would otherwise download its browser in one.

The tests need the database from `npm run db:up`. Each run, of either suite, deletes the users it created (see `e2e/global-setup.ts` and `e2e-vibium/run.mjs`); accounts from before the run are left alone.

The same steps run on GitHub Actions for every push and pull request (`.github/workflows/test.yml`), in Chromium only: see the WebKit note under "Important Notes".

## Project Structure

```
passkey-playground/
├── server/           # Fastify backend with WebAuthn endpoints
│   └── src/
│       ├── index.ts          # Server setup, including the session cookie
│       ├── routes/auth.ts    # Register + Login WebAuthn endpoints
│       ├── db/schema.ts      # Users + Credentials tables
│       ├── lib/session.ts    # Session data types and auth guard
│       └── lib/challenges.ts # Makes each WebAuthn challenge single-use
│
├── client/           # Vanilla TypeScript frontend
│   └── src/
│       ├── views/            # Register, Login, Dashboard views
│       ├── api.ts            # API client
│       └── main.ts           # Hash router
│
├── e2e/              # ⭐ Playwright tests (the main attraction)
    ├── global-setup.ts           # Deletes the users a test run creates
    ├── fixtures/
    │   ├── webauthn.fixture.ts   # Reusable CDP authenticator fixture
    │   └── app.ts                # How the tests operate the app (register, login, ...)
    └── tests/
        ├── passkey-register.spec.ts           # Registration tests
        ├── passkey-login.spec.ts              # Login tests
        ├── passkey-cdp-demo.spec.ts           # 📖 Commented guide: CDP
        └── passkey-credentials-demo.spec.ts   # 📖 Commented guide: context.credentials
│
└── e2e-vibium/       # The same with Vibium and Node's test runner
    ├── run.mjs                   # Starts the app, runs the tests, deletes test users
    ├── support/
    │   ├── app.ts                         # How the tests operate the app
    │   ├── cdp-authenticator.ts           # Route A: CDP through WebDriver BiDi
    │   ├── soft-authenticator.ts          # Route B: installs the script below
    │   └── soft-authenticator.page.js     # The authenticator that runs in the page
    └── tests/
        ├── passkey-cdp-demo.test.ts                 # 📖 Commented guide: Route A
        └── passkey-soft-authenticator-demo.test.ts  # 📖 Commented guide: Route B
```

## Key File: `passkey-cdp-demo.spec.ts`

This is the **core learning resource**. It walks through:

1. **Creating a CDP session** — How to get low-level browser access, and what a ceremony does while no authenticator exists
2. **Adding virtual authenticators** — Configuration options explained
3. **Full registration + login flow** — End-to-end with credential inspection
4. **Multiple authenticators** — Platform + USB, and how to choose which one answers
5. **User verification failure** — An authenticator whose check fails
6. **Toggling user verification** — Fail and succeed within one test
7. **Seeding with `addCredential`** — Log in with a passkey captured earlier

Steps 1 and 2 send the CDP commands by hand. From Step 3 on the tests use the `authenticator` fixture, which wraps the same commands and cleans up after a failed test too.

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
| **Browsers** | Chromium only | All browsers according to the [release notes](https://playwright.dev/docs/release-notes); tested here in Chromium and WebKit (WebKit not on Linux, see below) |
| **How it works** | Virtual authenticator inside the browser, so its WebAuthn stack runs | Script replaces `navigator.credentials.create()` and `.get()`; keys live in the Playwright process |
| **Setup** | CDP session, `WebAuthn.enable`, `addVirtualAuthenticator` | `context.credentials.install()` |
| **User verification** | Configurable, including failure (`isUserVerified: false`) | Always succeeds |
| **Transports** | `internal`, `usb`, `ble`, `nfc` | Always `internal`, attachment `platform` |
| **Several authenticators** | Yes. All of them answer a ceremony unless you switch off automatic presence on the others | No, one per context |
| **Seeding passkeys** | `WebAuthn.addCredential` | `create()` |
| **Reuse across tests** | Build it yourself | `storageState({ credentials: true })` |
| **`signCount` after registration** | 1 | 0 |

**Use `context.credentials`** for most passkey tests: login flows, seeded users and anything that should also run outside Chromium.

**Use CDP** when the authenticator itself is what you test: failed user verification, specific transports, several authenticators, or the browser's own WebAuthn behaviour.

The [`Credentials` docs](https://playwright.dev/docs/api/class-credentials) say nothing about user verification or transports. Those two rows come from the source of Playwright 1.64, and Step 5a of the demo fails if the behaviour changes.

## The Same with Vibium

[Vibium](https://github.com/VibiumDev/vibium) is built on WebDriver BiDi, which has no WebAuthn commands, so it has no passkey API. `e2e-vibium/` shows two ways to get one anyway. They mirror the two Playwright approaches above.

| | Route A: CDP through BiDi | Route B: software authenticator |
|---|---|---|
| **Playwright counterpart** | CDP (`WebAuthn.*`) | `context.credentials` |
| **How it works** | chromedriver's `goog:cdp.sendCommand` carries CDP commands over BiDi, and Vibium passes them on. The browser's WebAuthn stack runs | `context.addInitScript()` replaces `navigator.credentials.create()` and `.get()` with an authenticator written in JavaScript; real ES256 keys from WebCrypto |
| **Browsers** | Chrome only | Not tied to an engine; run here in Chrome only (`VIBIUM_ENGINE=firefox` to try Firefox) |
| **Vibium API used** | `browser.client`, which the typings mark as private | Public API only |
| **User verification** | Configurable, including failure | Always succeeds |
| **Seeding passkeys** | `WebAuthn.addCredential` | Second argument of `installSoftAuthenticator()` |
| **`signCount` after registration** | 1 | 0 |
| **You maintain** | A thin wrapper (`support/cdp-authenticator.ts`) | The authenticator itself (`support/soft-authenticator.page.js`, about 200 lines) |

**Use Route B** by default: it depends on nothing that Vibium does not document. **Use Route A** when the authenticator's behaviour is what you test, and accept that a Vibium update may break the private access.

Vibium is an automation library, not a test framework. The tests run on Node's built-in test runner, and `e2e-vibium/run.mjs` starts the app and cleans up, which Playwright's config does for the other suite.

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
- **WebKit runs on macOS and Windows only**: Playwright's WebKit build for Linux has no `window.PublicKeyCredential`. `context.credentials` still replaces `navigator.credentials` there (Step 5a, which calls it directly, passes), but `@simplewebauthn/browser` checks for that global first and reports "WebAuthn is not supported in this browser". The WebKit project is therefore left out on Linux, which includes CI.
- **Firefox is not part of the test run**: Playwright's Firefox 157 build exits during startup on the macOS 27 machine this was developed on, with `Could not find profile folder`. It also happens when starting the binary directly, without Playwright. The cause is unknown, so whether the demo passes in Firefox is untested.
- **localhost**: WebAuthn requires a secure context. `localhost` is treated as secure.
- Tests run sequentially (`workers: 1`, set in `e2e/playwright.config.ts`)

## Not Production-Ready

The server exists to give the tests something real to talk to. It verifies WebAuthn responses properly, but it is not a template for a production login:

- **Sessions live in the cookie.** The server keeps no session list, so signing out clears the cookie in that browser but cannot invalidate a copy of it. Server-side sessions would fix that.
- **Challenges are tracked in memory.** Each challenge works once (`server/src/lib/challenges.ts`), but the list is lost on restart and not shared between several server instances.
- **No rate limiting**, no account recovery, and no way to list or remove passkeys.
- **Username enumeration**: registration tells you whether a name is taken.
