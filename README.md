# 🔑 Passkey Playground

A minimal demo app with passkey login, and two test suites that show how to **test WebAuthn/passkey flows without real hardware**: one with **[Playwright](https://playwright.dev)**, one with **[Vibium](https://github.com/VibiumDev/vibium)**.

Both suites show the same two approaches. Either a virtual authenticator inside the browser answers the ceremony, set up with the Chrome DevTools Protocol (CDP), or a script in the page replaces `navigator.credentials` with an authenticator of its own.

| | Playwright | Vibium |
|---|---|---|
| **Folder** | `e2e/` | `e2e-vibium/` |
| **Test runner** | Playwright Test | Node's test runner |
| **Passkey support** | Built in | None: WebDriver BiDi, which Vibium is built on, has no WebAuthn commands |
| **Virtual authenticator in the browser** | CDP session (`WebAuthn.*`) | The same CDP commands, sent through chromedriver |
| **Authenticator replaced in the page** | `context.credentials` | A software authenticator written for this project |
| **What the suite covers** | Guided demos of both approaches, tests for registration and login, and what the server must reject | Guided demos of both approaches |
| **Run it** | `npm test` | `npm run test:vibium` |
| **Read more** | [Playwright: CDP or `context.credentials`?](#playwright-cdp-or-contextcredentials) | [Vibium: CDP or a Software Authenticator?](#vibium-cdp-or-a-software-authenticator) |

## Contents

**Using the project**

- [Setup](#setup)
- [Try the App by Hand](#try-the-app-by-hand)
- [Run the Tests](#run-the-tests)
- [Write Your Own Test](#write-your-own-test)
- [Stop and Reset](#stop-and-reset)
- [Troubleshooting](#troubleshooting)
- [Configuration](#configuration)
- [Change the Database Schema](#change-the-database-schema)

**Understanding it**

- [What This Project Demonstrates](#what-this-project-demonstrates)
- [Project Structure](#project-structure)
- [The Guided Demos](#the-guided-demos)
- [Playwright: CDP or `context.credentials`?](#playwright-cdp-or-contextcredentials)
- [Vibium: CDP or a Software Authenticator?](#vibium-cdp-or-a-software-authenticator)
- [How CDP WebAuthn Works](#how-cdp-webauthn-works)
- [Server API](#server-api)
- [Browser Support](#browser-support)
- [Not Production-Ready](#not-production-ready)

---

# Using the Project

## Setup

You need **Node.js ≥ 22** and **Docker** with Docker Compose.

```bash
# 1. Clone and install
git clone https://github.com/MockThePlank/passkey-playground.git
cd passkey-playground
npm install

# 2. Create the config (the defaults match Docker Compose)
cp .env.example .env

# 3. Start PostgreSQL
npm run db:up

# 4. Create the tables
npm run db:migrate
```

That is all the tests need. Steps 1, 2 and 4 are needed once, step 3 after every restart of Docker or your machine.

## Try the App by Hand

```bash
npm run dev
```

This starts the backend on port 3000 and the frontend on **http://localhost:5173**. Open that address, choose a username and create a passkey; after signing out you can sign in with it again.

Two ways to answer the passkey prompt:

- **A real authenticator**: Touch ID, Windows Hello, a security key or a password manager. The passkey is saved for `localhost` and stays there until you delete it in that authenticator.
- **Chrome's virtual authenticator**: open DevTools, then *More tools → WebAuthn*, tick *Enable virtual authenticator environment* and add an authenticator with *Supports resident keys* and *Supports user verification*. Nothing is saved outside that tab. This is the same mechanism the CDP tests use.

Use `localhost`, not `127.0.0.1`: the passkeys are bound to the name in `RP_ID`.

## Run the Tests

**The tests start the app themselves.** You do not need `npm run dev` for them, only the database. If the app is already running, both suites use it instead of starting a second one.

### Playwright

```bash
# Install the browsers (first time only)
npx playwright install chromium webkit

# Run all tests
npm test

# Run with UI mode (great for debugging)
npm run test:ui

# Run headed (see the browser)
npm run test:headed -w e2e

# Run a single test file
npm test -w e2e -- tests/passkey-register.spec.ts

# Run the tests whose title matches
npm test -w e2e -- -g "Step 4"
```

The HTML report opens by itself after a failed run. To open the last one again:

```bash
npx playwright show-report e2e/playwright-report
```

### Vibium

```bash
# Install Chrome for Testing (first time only)
npx vibium install

# Run the Vibium suite
npm run test:vibium

# Run headed (see the browser; macOS and Linux)
npm run test:headed -w e2e-vibium

# Run a single step
npm test -w e2e-vibium -- --test-name-pattern "Step 2"
```

`npx vibium install` is needed because this repository does not run install scripts of dependencies (`allowScripts` in `package.json`), and Vibium would otherwise download its browser in one.

The results go to the terminal; this suite writes no report.

### Typecheck

```bash
npm run typecheck
```

### What a Test Run Leaves Behind

Each run, of either suite, deletes the users it created (see `e2e/global-setup.ts` and `e2e-vibium/run.mjs`). Accounts from before the run are left alone, so the ones you made by hand survive.

### On GitHub Actions

`.github/workflows/test.yml` runs the typecheck and both suites for every pull request and every push to `main`, in Chromium only (see [Browser Support](#browser-support)). The Playwright report is attached to the run as the artifact `playwright-report` and kept for 7 days.

## Write Your Own Test

### Playwright

Put a `*.spec.ts` file into `e2e/tests/`. Import `test` from the fixture, not from `@playwright/test`: asking for `authenticator` gives the page a virtual authenticator and removes it afterwards.

```ts
import { test, expect } from '../fixtures/webauthn.fixture.js';
import { loginViaUi, logout, registerViaUi, uniqueName } from '../fixtures/app.js';

test('signs in again after signing out', async ({ page, authenticator }) => {
  const username = uniqueName('mytest');

  await registerViaUi(page, username);
  await logout(page);
  await loginViaUi(page, username);

  // The authenticator holds one passkey, used twice: created, then signed in
  const [passkey] = await authenticator.getCredentials();
  expect(passkey.signCount).toBe(2);
});
```

What you have to work with:

| | |
|---|---|
| `registerViaUi`, `loginViaUi`, `logout` | Operate the app and wait for the result |
| `submitRegistration`, `submitLogin` | Start a ceremony without waiting, for tests that expect a failure |
| `message(page)` | The line under the form that reports success or failure |
| `currentUser(page)` | Asks the server who is signed in |
| `uniqueName(prefix)` | A username no other test uses |
| `authenticator.getCredentials()`, `.addCredential()`, `.setUserVerified()`, … | Inspect and control the authenticator; the full list is in `e2e/fixtures/webauthn.fixture.ts` |

A different authenticator for a file or a `describe` block:

```ts
test.use({ authenticatorOptions: { transport: 'usb', isUserVerified: false } });
```

Find elements by role, label or text, as the helpers do, not by id or CSS class.

#### Testing What the Server Rejects

The app is an honest client: it sends the server whatever the authenticator returns. A failed fingerprint check ends in the browser, and the server never hears of it. To test the server's own checks, the test has to be the client. `e2e/fixtures/ceremony.ts` runs a ceremony in steps, so the test can change the request or the response in between:

```ts
import { createRegistration, verify, withClientData } from '../fixtures/ceremony.js';

test('rejects a response from another origin', async ({ page, authenticator }) => {
  await page.goto('/');

  const response = await createRegistration(page, uniqueName('origin'));
  const forged = withClientData(response, { origin: 'https://evil.example' });

  expect(await verify(page, 'register', forged)).toEqual({
    status: 400,
    body: { error: 'Verification failed' },
  });
});
```

`passkey-server-verification.spec.ts` uses this for missing user verification, a broken signature, a foreign origin, challenge or relying party, an unknown passkey, and a username that is claimed while a registration is under way.

A spec that uses the fixture runs in Chromium only, because the fixture needs CDP. For a test that should also run in WebKit, use `context.credentials` instead of the fixture, and add the file to `testMatch` of the `webkit` project in `e2e/playwright.config.ts`.

### Vibium

Put a `*.test.ts` file into `e2e-vibium/tests/`. There are no fixtures, so the test starts and stops the browser itself:

```ts
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Browser } from 'vibium';
import { loginViaUi, logout, registerViaUi, startBrowser, uniqueName } from '../support/app.js';
import { getPasskeys, installSoftAuthenticator } from '../support/soft-authenticator.js';

let browser: Browser;
before(async () => {
  browser = await startBrowser();
});
after(() => browser.stop());

test('signs in again after signing out', async () => {
  const context = await browser.newContext();
  await installSoftAuthenticator(context); // before the first page
  const page = await context.newPage();
  const username = uniqueName('mytest');

  await registerViaUi(page, username);
  await logout(page);
  await loginViaUi(page, username);

  const [passkey] = await getPasskeys(page);
  assert.equal(passkey.signCount, 1);
});
```

For a test that needs the browser's own authenticator, for example one that fails user verification, use `createCdpAuthenticator(browser, page)` from `support/cdp-authenticator.ts` instead.

## Stop and Reset

```bash
# Stop the dev servers: Ctrl+C in the terminal running `npm run dev`

# Stop PostgreSQL, keep the data
npm run db:down

# Delete the data too, then start with an empty database
docker compose down -v
npm run db:up
npm run db:migrate
```

Deleting the data removes the accounts but not the passkeys in your real authenticator. Those then point at users that no longer exist; delete them there, or sign-in offers them and fails.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `DATABASE_URL is not set` | There is no `.env`. Run `cp .env.example .env`. |
| Playwright stops with `AggregateError` at `global-setup.ts`, Vibium with `ECONNREFUSED` on port 5432 | The database is not running. Start Docker, then `npm run db:up`. |
| `relation "users" does not exist` | The tables are missing. Run `npm run db:migrate`. |
| `npm run db:up` fails with `port is already allocated` | Another PostgreSQL uses port 5432. Stop it, or change the port in `docker-compose.yml` and in `DATABASE_URL`. |
| Tests fail at once with pages that are not this app | Something else runs on port 3000 or 5173. Locally the tests use whatever answers there. Stop it. |
| The app opens on port 5174 and passkeys fail | Port 5173 was taken, so Vite moved on. The server only accepts `RP_ORIGIN`. Free the port. |
| Playwright: `Executable doesn't exist` | The browsers are missing. Run `npx playwright install chromium webkit`. |
| Vibium cannot find or start a browser | Run `npx vibium install`. |
| Vibium on Linux: `session not created: Chrome instance exited` | Chrome's sandbox cannot start, as on GitHub's runners. Run with `VIBIUM_CHROME_ARGS=--no-sandbox`, as the workflow does. `VIBIUM_CHROMEDRIVER_LOG_DIR=<folder>` writes a log that names the reason. |
| Vibium: `timeout waiting for chromedriver` | `VIBIUM_CHROMEDRIVER_LOG_DIR` points to a folder that does not exist. Create it first. |
| `WebAuthn is not supported in this browser` | WebKit on Linux, see [Browser Support](#browser-support). Or the page is not on `localhost` and not on HTTPS. |
| A passkey prompt appears and fails in the browser by hand | You opened `127.0.0.1`. Use `localhost`. |
| Sign-in by hand offers a passkey and then fails | The passkey belongs to an account that was deleted. Remove it from your authenticator. |
| `npm run test:headed -w e2e-vibium` fails on Windows | The script sets `HEADED=1` the Unix way. Set the variable yourself, then run `npm run test:vibium`. |

When a Playwright test fails, the report has a screenshot, and after a retry (CI only) a trace. `npm run test:ui` lets you step through a test.

## Configuration

Everything is read from `.env` in the repository root. The defaults in `.env.example` work as they are.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://passkey:passkey@localhost:5432/passkey_playground` | Where the server, the migrations and the test cleanup find the database. Required. |
| `PORT` | `3000` | Port of the backend |
| `HOST` | `localhost` | Address the backend listens on |
| `RP_ID` | `localhost` | The domain passkeys are bound to |
| `RP_NAME` | `Passkey Playground` | The name an authenticator shows next to the passkey |
| `RP_ORIGIN` | `http://localhost:5173` | The only origin the server accepts WebAuthn responses from |
| `SESSION_SECRET` | a development value | Encrypts the session cookie. Required when `NODE_ENV=production`. |

Ports 3000 and 5173 are also written into `client/vite.config.ts`, `e2e/playwright.config.ts` and `e2e-vibium/`. Changing `PORT` or the frontend port means changing them there as well.

## Change the Database Schema

The schema is in `server/src/db/schema.ts`, the migrations are committed in `server/drizzle/`.

```bash
# After editing schema.ts: write a new migration
npm run db:generate

# Apply it
npm run db:migrate
```

Commit the generated files. CI and everyone else get the change through `npm run db:migrate`.

---

# Understanding It

## What This Project Demonstrates

**The app**

- Implementing WebAuthn registration and login with `@simplewebauthn`

**With Playwright**

- Using CDP sessions to create virtual authenticators
- Inspecting credentials, sign counts, and authenticator state via CDP
- Configuring virtual authenticators (platform and USB), choosing which one answers, and simulating failed user verification
- Seeding a known passkey with CDP (`WebAuthn.addCredential`) so a test can start at the login
- Using `context.credentials` to register, seed and reuse passkeys without CDP
- Testing what the server must reject (missing user verification, a foreign origin, a broken signature) by tampering with a ceremony between browser and server

**With Vibium**

- Reaching CDP although Vibium speaks WebDriver BiDi, to create, inspect and seed virtual authenticators and to simulate failed user verification
- Replacing `navigator.credentials` with a software authenticator installed as an init script, and seeding a passkey into it

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla TypeScript, Vite |
| Backend | Fastify, `@simplewebauthn/server` |
| Database | PostgreSQL (Docker) |
| ORM | Drizzle |
| Testing | Playwright (CDP WebAuthn and `context.credentials`), Vibium with Node's test runner |

## Project Structure

```
passkey-playground/
├── server/           # Fastify backend with WebAuthn endpoints
│   ├── drizzle/              # Committed database migrations
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
│   ├── playwright.config.ts      # Browsers, and starting the app
│   ├── global-setup.ts           # Deletes the users a test run creates
│   ├── fixtures/
│   │   ├── webauthn.fixture.ts   # Reusable CDP authenticator fixture
│   │   ├── app.ts                # How the tests operate the app (register, login, ...)
│   │   └── ceremony.ts           # Runs a ceremony step by step, to tamper with it
│   └── tests/
│       ├── passkey-register.spec.ts           # Registration tests
│       ├── passkey-login.spec.ts              # Login tests
│       ├── passkey-server-verification.spec.ts # What the server must reject
│       ├── passkey-cdp-demo.spec.ts           # 📖 Commented guide: CDP
│       └── passkey-credentials-demo.spec.ts   # 📖 Commented guide: context.credentials
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

## The Guided Demos

Four test files are written to be read from top to bottom. Each step is a test you can run on its own, for example `npm test -w e2e -- -g "Step 4"`.

### `e2e/tests/passkey-cdp-demo.spec.ts`

The **core learning resource**. It walks through:

1. **Creating a CDP session** — How to get low-level browser access, and what a ceremony does while no authenticator exists
2. **Adding virtual authenticators** — Configuration options explained
3. **Full registration + login flow** — End-to-end with credential inspection
4. **Multiple authenticators** — Platform + USB, and how to choose which one answers
5. **User verification failure** — An authenticator whose check fails
6. **Toggling user verification** — Fail and succeed within one test
7. **Seeding with `addCredential`** — Log in with a passkey captured earlier

Steps 1 and 2 send the CDP commands by hand. From Step 3 on the tests use the `authenticator` fixture, which wraps the same commands and cleans up after a failed test too.

### `e2e/tests/passkey-credentials-demo.spec.ts`

The counterpart to the CDP demo, using Playwright's built-in API:

1. **`install()` and `get()`** — Register a passkey and read it back
2. **Login** — Watch the signature counter go up
3. **`create()`** — Seed passkeys, and see what the server does with unknown keys and old counters
4. **Storage state** — Reuse a session and its passkey in a new context
5. **Limits** — What this API cannot simulate

### `e2e-vibium/tests/`

`passkey-cdp-demo.test.ts` (Route A) and `passkey-soft-authenticator-demo.test.ts` (Route B) repeat the central steps of the two files above with Vibium. See [Vibium: CDP or a Software Authenticator?](#vibium-cdp-or-a-software-authenticator).

## Playwright: CDP or `context.credentials`?

| | CDP (`WebAuthn.*`) | `context.credentials` |
|---|---|---|
| **Browsers** | Chromium only | All browsers according to the [release notes](https://playwright.dev/docs/release-notes); tested here in Chromium and WebKit (WebKit not on Linux, see [Browser Support](#browser-support)) |
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

## Vibium: CDP or a Software Authenticator?

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

The virtual authenticator is part of the browser. The page calls `navigator.credentials` as usual and the browser's own WebAuthn code runs; only the hardware at the end is replaced. CDP is how the test creates and controls that replacement. It does not sit between the page and the authenticator.

```
┌─────────────────────────── Chromium ───────────────────────────┐
│                                                                │
│  ┌────────────┐  navigator.credentials  ┌───────────────────┐  │
│  │            │ ──────────────────────▶ │  Virtual          │  │
│  │  Your app  │                         │  authenticator    │  │
│  │            │ ◀────────────────────── │  (no hardware)    │  │
│  └────────────┘  signed response        └───────────────────┘  │
│                                                   ▲            │
└───────────────────────────────────────────────────│────────────┘
                                                    │ WebAuthn.*
                                                    │ commands (CDP)
                                          ┌───────────────────┐
                                          │  Your test code   │
                                          └───────────────────┘
```

Playwright sends the commands through a CDP session (`context.newCDPSession(page)`), Vibium through chromedriver's `goog:cdp.sendCommand`. The commands are the same:

| Command | Purpose |
|---------|---------|
| `WebAuthn.enable` | Switch the page to virtual authenticators |
| `WebAuthn.disable` | Switch back |
| `WebAuthn.addVirtualAuthenticator` | Create a virtual authenticator |
| `WebAuthn.removeVirtualAuthenticator` | Remove one |
| `WebAuthn.getCredentials` | List stored credentials |
| `WebAuthn.addCredential` | Manually inject a credential |
| `WebAuthn.removeCredential` | Remove a specific credential |
| `WebAuthn.clearCredentials` | Wipe all credentials |
| `WebAuthn.setUserVerified` | Toggle user verification at runtime |
| `WebAuthn.setAutomaticPresenceSimulation` | Toggle automatic user presence |

## Server API

The frontend reaches the backend through Vite's proxy, so everything is under `http://localhost:5173/api`.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/register/options` | Body `{ "username": "…" }`. Returns the options for `navigator.credentials.create()` and remembers the challenge. `409` if the name is taken. |
| `POST /api/auth/register/verify` | Body: the browser's registration response. Stores user and passkey, signs the user in. |
| `POST /api/auth/login/options` | Returns the options for `navigator.credentials.get()`. No username: the passkey identifies the user. |
| `POST /api/auth/login/verify` | Body: the browser's authentication response. Signs the user in. |
| `GET /api/auth/me` | The signed-in user, or `401`. |
| `POST /api/auth/logout` | Ends the session. |
| `GET /api/health` | `{ "status": "ok" }` |

A challenge works once. Each `verify` call uses it up whether or not the verification succeeds, so a second call answers `400`. User verification is required in both ceremonies.

## Browser Support

- **CDP is Chromium only**: CDP WebAuthn is not available in Firefox or WebKit, so those specs run in Chromium only. `context.credentials` has no such limit.
- **WebKit runs on macOS and Windows only**: Playwright's WebKit build for Linux has no `window.PublicKeyCredential`. `context.credentials` still replaces `navigator.credentials` there (Step 5a, which calls it directly, passes), but `@simplewebauthn/browser` checks for that global first and reports "WebAuthn is not supported in this browser". The WebKit project is therefore left out on Linux, which includes CI.
- **Firefox is untested**: there is no Firefox project. On the machine this was developed on (macOS 27), Playwright's Firefox 157 build exits during startup with `Could not find profile folder`, also when started without Playwright. Whether the demo passes in Firefox is therefore unknown.
- **`localhost`**: WebAuthn requires a secure context. `localhost` is treated as secure.
- **One worker**: the tests run sequentially (`workers: 1`, set in `e2e/playwright.config.ts`).

## Not Production-Ready

The server exists to give the tests something real to talk to. It verifies WebAuthn responses properly, but it is not a template for a production login:

- **Sessions live in the cookie.** The server keeps no session list, so signing out clears the cookie in that browser but cannot invalidate a copy of it. Server-side sessions would fix that.
- **Challenges are tracked in memory.** Each challenge works once (`server/src/lib/challenges.ts`), but the list is lost on restart and not shared between several server instances.
- **No rate limiting**, no account recovery, and no way to list or remove passkeys.
- **Username enumeration**: registration tells you whether a name is taken.
