# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start PostgreSQL (Docker required)
npm run db:up

# Run Drizzle migrations (committed in server/drizzle)
npm run db:migrate

# Only after changing server/src/db/schema.ts: generate a new migration
npm run db:generate

# Start both server (port 3000) and client (port 5173)
npm run dev

# Run all Playwright tests (sequential; the context.credentials demo also runs in WebKit)
npm test

# Run tests with Playwright UI mode
npm run test:ui

# Run a single test file
npm test -w e2e -- tests/passkey-register.spec.ts

# Typecheck all packages
npm run typecheck

# Run headed (visible browser)
npm run test:headed -w e2e

# Run the Vibium suite (first time: npx vibium install)
npm run test:vibium

# Run a single Vibium test
npm test -w e2e-vibium -- --test-name-pattern "Step 2"
```

## Architecture

This is an npm workspaces monorepo with four packages: `server`, `client`, `e2e`, and `e2e-vibium`.

**Server** (`server/`) — Fastify backend on port 3000
- WebAuthn registration/login via `@simplewebauthn/server` under `/api/auth/*`
- PostgreSQL with Drizzle ORM (two tables: `users` and `credentials`)
- Session management via `@fastify/secure-session` (cookie-based, 24h TTL)
- Challenges are stored in the session and are single-use: `lib/challenges.ts` keeps an in-memory list, and each verify endpoint consumes the challenge whether or not verification succeeds
- User verification is required, both in the options and in the verification
- Registration stores the user and the credential in one transaction
- Credential signature counters are incremented on each login for replay protection
- Config (RP_ID, RP_ORIGIN, SESSION_SECRET, DATABASE_URL) loaded from env vars

**Client** (`client/`) — Vanilla TypeScript SPA built with Vite
- Hash-based router (`#/login`, `#/register`, `#/dashboard`) in `main.ts`
- API calls go through `api.ts` using `fetch` with `credentials: 'same-origin'`
- WebAuthn browser-side ceremony via `@simplewebauthn/browser`
- No framework — direct DOM manipulation in view files

**E2E** (`e2e/`) — Playwright tests using CDP virtual authenticators and `context.credentials`
- `fixtures/webauthn.fixture.ts` provides the `authenticator` fixture (configurable with `test.use({ authenticatorOptions })`) and a `createVirtualAuthenticator()` helper that sets up a CDP session with `WebAuthn.enable` and returns methods for credential inspection
- `fixtures/app.ts` holds the helpers that operate the app (`registerViaUi`, `loginViaUi`, `logout`, `message`). Use them, and role/label locators, instead of ids or CSS classes
- `global-setup.ts` deletes the users a run created; it needs `DATABASE_URL` (read from the root `.env`)
- Tests run with `workers: 1` (WebAuthn state is per browser context). CDP specs are Chromium-only; `passkey-credentials-demo.spec.ts` also runs in WebKit, except on Linux (and so not in CI), where Playwright's WebKit has no `window.PublicKeyCredential`
- Playwright config auto-starts both server and client via `webServer`
- `passkey-cdp-demo.spec.ts` and `passkey-credentials-demo.spec.ts` are commented learning guides, not just test files

**E2E Vibium** (`e2e-vibium/`) — the same flows with Vibium on Node's test runner (`node:test`, loaded through `tsx`)
- Vibium has no WebAuthn API. `support/cdp-authenticator.ts` reaches CDP through chromedriver's `goog:cdp.sendCommand` (Chrome only, uses the private `browser.client`); `support/soft-authenticator.ts` installs `soft-authenticator.page.js` as an init script that replaces `navigator.credentials`
- `soft-authenticator.page.js` runs in the page and is read as text: keep it self-contained plain JavaScript
- `run.mjs` starts server and client if they are not running, runs the tests and deletes the users the run created
- Vibium's install script is denied in `allowScripts`; the browser comes from `npx vibium install`

## Environment

Copy `.env.example` to `.env` in the repository root. Default values work with the Docker Compose PostgreSQL setup (user: `passkey`, password: `passkey`, db: `passkey_playground`).
