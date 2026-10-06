import { expect, test } from '@playwright/test';

test('default dashboard opens configured Runs without legacy comparison requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { requests.push(new URL(request.url()).pathname); });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Run management', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Comparisons', exact: true })).toHaveCount(0);
  await expect.poll(() => requests.includes('/api/configured-runs')).toBe(true);
  expect(requests.some((path) => path === '/api/runs' || path.startsWith('/api/evaluations'))).toBe(false);
  await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await page.getByRole('button', { name: 'New suite', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Export / })).toHaveCount(0);
});
