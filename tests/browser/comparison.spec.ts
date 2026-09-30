import { expect, test } from '@playwright/test';

test('compare blind text, save one choice, reveal identities and resume after reload', async ({ page, browser }) => {
  const responses: string[] = [];
  page.on('response', async (response) => { if (response.url().includes('/api/')) responses.push(await response.text()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Compare answers' }).first().click();
  await expect(page.getByRole('heading', { name: 'Which answer is better?' })).toBeVisible();
  await expect(page.getByText('DETERMINISTIC DEMO · NO MODEL CALLS')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(2);
  expect(responses.join('\n')).not.toMatch(/gpt-6|attemptId|reportId|cliVersion|runId/);
  await expect(page.locator('body')).not.toContainText('gpt-6');
  const order = await page.locator('.card pre').allTextContents();
  await page.reload();
  await expect(page.locator('.card pre')).toHaveCount(2);
  expect(await page.locator('.card pre').allTextContents()).toEqual(order);
  const sessionUrl = page.url();
  const stranger = await browser.newContext();
  const other = await stranger.newPage(); await other.goto(sessionUrl);
  await expect(other.getByRole('alert')).toHaveText('Not found'); await stranger.close();
  await page.getByRole('button', { name: 'Choose answer A' }).click();
  await expect(page.getByRole('heading', { name: 'Your choice is saved.' })).toBeVisible();
  await expect(page.locator('.identity')).toHaveCount(2);
  await expect(page.locator('body')).toContainText('gpt-6-luna'); await expect(page.locator('body')).toContainText('gpt-6-sol');
  await page.reload(); await expect(page.locator('.selected h2')).toHaveText('Answer A');
  expect(await page.locator('.card pre').allTextContents()).toEqual(order);
  await page.screenshot({ path: '.artifacts/comparison-revealed.png', fullPage: true });
});
