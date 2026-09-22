import { test, expect } from '@playwright/test';
import { startBrowserFixture, type BrowserFixture } from './fixture-server.js';

let fixture: BrowserFixture;

test.beforeEach(async () => {
  fixture = await startBrowserFixture();
});
test.afterEach(async () => {
  await fixture.close();
});

test('logs in and renders the task workspace without interpreting task text as HTML', async ({
  page,
  browser,
}) => {
  await page.goto(fixture.url);
  await page.getByLabel('Access code').fill(fixture.accessCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByText('exploration · needs-plan')).toBeVisible();

  await page.getByRole('button', { name: 'Server settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Server settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close settings' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Server settings' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Server settings' })).toBeFocused();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto(fixture.url);
  await secondPage.getByLabel('Access code').fill(fixture.accessCode);
  await secondPage.getByRole('button', { name: 'Continue' }).click();
  await expect(secondPage.getByText('exploration · needs-plan')).toBeVisible();
  await secondContext.close();
});
