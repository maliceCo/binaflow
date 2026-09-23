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
  await expect(page.getByText('exploration · needs-plan')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  const recentRow = page.locator('.recent-tasks li').first();
  await expect(recentRow).toBeVisible();
  await expect(recentRow).toHaveCSS('border-top-width', '1px');
  const recentRowBox = await recentRow.boundingBox();
  expect(recentRowBox).not.toBeNull();
  expect(recentRowBox!.x).toBeGreaterThanOrEqual(0);
  expect(recentRowBox!.x + recentRowBox!.width).toBeLessThanOrEqual(375);
  const recentContentBox = await recentRow.locator('div').boundingBox();
  const recentButtonBox = await recentRow.locator('button').boundingBox();
  expect(recentContentBox).not.toBeNull();
  expect(recentButtonBox).not.toBeNull();
  expect(recentButtonBox!.y).toBeGreaterThanOrEqual(recentContentBox!.y + recentContentBox!.height);

  const projectRows = page.locator('.project-list li');
  await expect(projectRows).toHaveCount(2);
  for (const row of await projectRows.all()) {
    await expect(row).toHaveCSS('border-top-width', '1px');
    const contentBox = await row.locator('span').boundingBox();
    const buttonBox = await row.locator('button').boundingBox();
    expect(contentBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y).toBeGreaterThanOrEqual(contentBox!.y + contentBox!.height);
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(375);
  }

  await projectRows.first().getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  const taskRow = page.locator('.task-list li').first();
  await expect(taskRow).toHaveCSS('border-top-width', '1px');
  const taskRowBox = await taskRow.boundingBox();
  expect(taskRowBox).not.toBeNull();
  expect(taskRowBox!.x).toBeGreaterThanOrEqual(0);
  expect(taskRowBox!.x + taskRowBox!.width).toBeLessThanOrEqual(375);
  const taskLinkBox = await taskRow.locator('a').boundingBox();
  const readinessBox = await taskRow.locator('span').boundingBox();
  expect(taskLinkBox).not.toBeNull();
  expect(readinessBox).not.toBeNull();
  expect(readinessBox!.y).toBeGreaterThanOrEqual(taskLinkBox!.y + taskLinkBox!.height);

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
