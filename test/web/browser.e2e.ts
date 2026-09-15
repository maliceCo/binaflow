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
}) => {
  await page.goto(fixture.url);
  await page.getByLabel('Access code').fill(fixture.accessCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByText('exploration: 123e4567')).toBeVisible();
});
