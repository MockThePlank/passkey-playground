import { expect, type Locator, type Page } from '@playwright/test';

// ─── App Helpers ────────────────────────────────────────────────────
//
// How the tests operate the demo app. Elements are found the way a person
// finds them, by label, role and text, so the tests keep working when ids
// or class names change.

export function uniqueName(prefix: string) {
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now()}-${random}`;
}

/** The line under the form that reports success or failure. */
export function message(page: Page): Locator {
  return page.getByRole('status');
}

/** Fills in the form and starts the ceremony, without waiting for a result. */
export async function submitRegistration(page: Page, username: string) {
  await page.goto('/#/register');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Create Passkey' }).click();
}

/** Starts the login ceremony, without waiting for a result. */
export async function submitLogin(page: Page) {
  await page.goto('/#/login');
  await page.getByRole('button', { name: 'Sign in with Passkey' }).click();
}

export async function expectSignedInAs(page: Page, username: string) {
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByText('Signed in as')).toContainText(username);
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
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/#\/login$/);
}

/** Asks the server who is signed in, using the page's own cookie. */
export function currentUser(page: Page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/auth/me');
    const body = (await res.json()) as { userId?: string; username?: string };
    return { status: res.status, body };
  });
}
