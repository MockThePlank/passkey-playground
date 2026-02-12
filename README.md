# 🔑 Passkey Playground

A minimal demo app that shows how to **test WebAuthn/Passkey flows with Playwright** using Chrome DevTools Protocol (CDP) virtual authenticators.

## What This Project Demonstrates

- Implementing WebAuthn registration and login with `@simplewebauthn`
- Testing passkey flows in Playwright **without real hardware**
- Using CDP sessions to create virtual authenticators
- Inspecting credentials, sign counts, and authenticator state via CDP
- Handling different authenticator configurations (platform, USB, UV failure)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla TypeScript, Vite |
| Backend | Fastify, `@simplewebauthn/server` |
| Database | PostgreSQL (Docker) |
| ORM | Drizzle |
| Testing | Playwright + CDP WebAuthn |

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Docker & Docker Compose

### Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd passkey-playground
npm install

# 2. Start PostgreSQL
npm run db:up

# 3. Generate and run migrations
npm run db:generate
npm run db:migrate

# 4. Start dev servers (backend + frontend)
npm run dev
```

App runs at **http://localhost:5173**

### Run Tests

```bash
# Install Playwright browsers (first time only)
npx playwright install chromium

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
│       ├── routes/auth.ts    # Register + Login WebAuthn endpoints
│       ├── db/schema.ts      # Users + Credentials tables
│       └── lib/session.ts    # Cookie session management
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
        ├── passkey-register.spec.ts   # Registration tests
        ├── passkey-login.spec.ts      # Login tests
        └── passkey-cdp-demo.spec.ts   # 📖 Commented learning guide
```

## Key File: `passkey-cdp-demo.spec.ts`

This is the **core learning resource**. It walks through:

1. **Creating a CDP session** — How to get low-level browser access
2. **Adding virtual authenticators** — Configuration options explained
3. **Full registration + login flow** — End-to-end with credential inspection
4. **Multiple authenticators** — Simulating platform + USB scenarios
5. **User verification failure** — Testing edge cases

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

## Important Notes

- **Chromium only**: CDP WebAuthn is not available in Firefox or WebKit
- **localhost**: WebAuthn requires a secure context. `localhost` is treated as secure.
- Tests run sequentially (`workers: 1`) because WebAuthn state is per-browser-context
