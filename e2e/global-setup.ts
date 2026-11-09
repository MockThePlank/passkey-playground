import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

// ─── Test Data Cleanup ──────────────────────────────────────────────
//
// Every run registers new users. This notes the database time before the
// first test and afterwards deletes the users created since then (their
// passkeys go with them, through the foreign key).
//
// Users from before the run stay untouched. An account you register by
// hand while the tests are running is deleted with the rest.

export default async function globalSetup() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch {
    // No .env file: DATABASE_URL has to come from the environment (as in CI)
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  }

  const sql = postgres(url, { max: 1 });
  const [{ startedAt }] = await sql`select now() as "startedAt"`;
  await sql.end();

  // Playwright runs the returned function as the global teardown
  return async () => {
    const sql = postgres(url, { max: 1 });
    await sql`delete from users where created_at >= ${startedAt}`;
    await sql.end();
  };
}
