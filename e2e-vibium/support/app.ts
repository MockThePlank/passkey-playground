import assert from 'node:assert/strict';
import { browser, type Browser, type Page } from 'vibium';

// ─── App Helpers ────────────────────────────────────────────────────
//
// How the tests operate the demo app with Vibium. The counterpart for
// Playwright is e2e/fixtures/app.ts; both find elements by label, role
// and text.

export const APP_URL = 'http://localhost:5173';
export const RP_ID = 'localhost';

const TIMEOUT = 5_000;

/** Starts a browser. HEADED=1 shows it, VIBIUM_ENGINE picks the engine. */
export function startBrowser(
  engine = (process.env.VIBIUM_ENGINE ?? 'chrome') as 'chrome' | 'firefox',
): Promise<Browser> {
  return browser.start({ engine, headless: !process.env.HEADED });
}

export function uniqueName(prefix: string) {
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now()}-${random}`;
}

/** Text of the line under the form that reports success or failure. */
export function messageText(page: Page): Promise<string> {
  return page.find({ role: 'status' }).text();
}

/** Waits until the message line shows exactly this text. */
export async function expectMessage(page: Page, expected: string) {
  const deadline = Date.now() + TIMEOUT;
  let actual = await messageText(page);
  while (actual !== expected && Date.now() < deadline) {
    await page.wait(100);
    actual = await messageText(page);
  }
  assert.equal(actual, expected);
}

/** Waits until the app shows the given route, e.g. 'dashboard'. */
export async function expectRoute(page: Page, route: string) {
  try {
    await page.waitForFunction(
      `location.hash === ${JSON.stringify(`#/${route}`)}`,
      { timeout: TIMEOUT },
    );
  } catch {
    assert.fail(
      `Expected route #/${route}, but the page is at ${await page.url()}`,
    );
  }
}

/** Fills in the form and starts the ceremony, without waiting for a result. */
export async function submitRegistration(page: Page, username: string) {
  await page.go(`${APP_URL}/#/register`);
  await page.find({ label: 'Username' }).fill(username);
  await page.find({ role: 'button', text: 'Create Passkey' }).click();
}

/** Starts the login ceremony, without waiting for a result. */
export async function submitLogin(page: Page) {
  await page.go(`${APP_URL}/#/login`);
  await page.find({ role: 'button', text: 'Sign in with Passkey' }).click();
}

export async function expectSignedInAs(page: Page, username: string) {
  await expectRoute(page, 'dashboard');
  const badge = await page.find({ text: 'Signed in as' }).text();
  assert.match(badge, new RegExp(`Signed in as ${username}$`));
}

export async function registerViaUi(page: Page, username: string) {
  await submitRegistration(page, username);
  await expectSignedInAs(page, username);
}

export async function loginViaUi(page: Page, username: string) {
  await submitLogin(page);
  await expectSignedInAs(page, username);
}

export async function logout(page: Page) {
  await page.find({ role: 'button', text: 'Sign Out' }).click();
  await expectRoute(page, 'login');
}
