# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start PostgreSQL (Docker required)
npm run db:up

# Generate and run Drizzle migrations
npm run db:generate
npm run db:migrate

# Start both server (port 3000) and client (port 5173)
npm run dev

# Run all Playwright tests (Chromium only, sequential)
npm test

# Run tests with Playwright UI mode
npm run test:ui

# Run a single test file
npx playwright test tests/passkey-register.spec.ts -w e2e

# Run headed (visible browser)
npm run test:headed -w e2e
```

## Architecture

This is an npm workspaces monorepo with three packages: `server`, `client`, and `e2e`.

**Server** (`server/`) — Fastify backend on port 3000
- WebAuthn registration/login via `@simplewebauthn/server` under `/api/auth/*`
- PostgreSQL with Drizzle ORM (two tables: `users` and `credentials`)
- Session management via `@fastify/secure-session` (cookie-based, 24h TTL)
- Challenges are stored in the session and verified immediately
- Credential signature counters are incremented on each login for replay protection
- Config (RP_ID, RP_ORIGIN, SESSION_SECRET, DATABASE_URL) loaded from env vars

**Client** (`client/`) — Vanilla TypeScript SPA built with Vite
- Hash-based router (`#/login`, `#/register`, `#/dashboard`) in `main.ts`
- API calls go through `api.ts` using `fetch` with `credentials: 'same-origin'`
- WebAuthn browser-side ceremony via `@simplewebauthn/browser`
- No framework — direct DOM manipulation in view files

**E2E** (`e2e/`) — Playwright tests using CDP virtual authenticators
- `fixtures/webauthn.fixture.ts` provides a `createVirtualAuthenticator()` helper that sets up a CDP session with `WebAuthn.enable` and returns methods for credential inspection
- Tests are Chromium-only and run with `workers: 1` (WebAuthn state is per browser context)
- Playwright config auto-starts both server and client via `webServer`
- `passkey-cdp-demo.spec.ts` is a commented learning guide, not just a test file

## Environment

Copy `.env.example` to `server/.env`. Default values work with the Docker Compose PostgreSQL setup (user: `passkey`, password: `passkey`, db: `passkey_playground`).
