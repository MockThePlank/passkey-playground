// ─── Test Runner ────────────────────────────────────────────────────
//
// Vibium is a browser automation library, not a test framework. The tests
// run on Node's built-in test runner, and this script does around them
// what Playwright's config does for the other suite:
//
//   1. start the server and the client, unless they are already running
//   2. run the tests
//   3. delete the users the run created
//
// Arguments are passed on to `node --test`, for example:
//   npm test -w e2e-vibium -- --test-name-pattern "Step 2"

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import postgres from 'postgres';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const SERVER = 'http://localhost:3000/api/health';
const CLIENT = 'http://localhost:5173';

try {
  process.loadEnvFile(`${root}.env`);
} catch {
  // No .env file: DATABASE_URL has to come from the environment (as in CI)
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
}

const reachable = (url) =>
  fetch(url).then(
    (res) => res.ok,
    () => false,
  );
const appIsUp = async () => (await reachable(SERVER)) && (await reachable(CLIENT));

async function startApp() {
  if (await appIsUp()) return null;

  // Its own process group, so that stopping it also stops its children
  const app = spawn('npm', ['run', 'dev'], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  });

  for (let attempt = 0; attempt < 120; attempt++) {
    if (await appIsUp()) return app;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  process.kill(-app.pid);
  throw new Error('Server and client did not start within 60 seconds');
}

function runTests() {
  const files = globSync('tests/*.test.ts', { cwd: here });
  const args = ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files];
  return new Promise((resolve) => {
    spawn(process.execPath, args, { cwd: here, stdio: 'inherit' }).on(
      'close',
      (code) => resolve(code ?? 1),
    );
  });
}

const sql = postgres(databaseUrl, { max: 1 });
const [{ startedAt }] = await sql`select now() as "startedAt"`;
const app = await startApp();

let exitCode = 1;
try {
  exitCode = await runTests();
} finally {
  // Users from before the run stay; their passkeys go with the users
  await sql`delete from users where created_at >= ${startedAt}`;
  await sql.end();
  if (app) process.kill(-app.pid);
}
process.exit(exitCode);
