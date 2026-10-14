import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { BlindGradingSession, BlindGradingTask } from '../../packages/contracts/src/blind-grading.ts';
export async function select(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: new RegExp(`^${label}( |$)`) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
export async function sessionFor(page: Page, runId: string) {
  const listing = await page.request.get('/api/dashboard/runs');
  const runs = await listing.json();
  const run = runs.find((r: { id: string }) => r.id === runId);
  const response = await page.request.post('/api/blind-grading', {
    headers: { origin: new URL(listing.url()).origin },
    data: { reviewId: run.reviewId, requestId: randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
  return BlindGradingSession.parse(await response.json());
}
export async function completedCard(page: Page, title: string, index = 0) {
  const loaded = page.waitForResponse((r) => /\/tasks\/[a-f0-9-]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET');
  await page.getByRole('treeitem', { name: new RegExp(`^${title}( |$)`) }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'One at a time', exact: true }).click();
  const response = await loaded;
  expect(response.ok()).toBeTruthy();
  const task = BlindGradingTask.parse(await response.json());
  await expect(page).toHaveURL(new RegExp(`task=${task.handle}`));
  const n = task.cards.map((card, n) => ({ card, n })).filter((x) => x.card.kind === 'completed')[index]?.n;
  if (n === undefined) throw new Error('No complete result');
  await page.getByRole('radio', { name: new RegExp(`^Result ${String.fromCharCode(65 + n)}(,|$)`) }).click();
  return page.getByRole('region', { name: `Result ${String.fromCharCode(65 + n)}`, exact: true });
}
export async function saved(page: Page, label: string) {
  const response = page.waitForResponse((r) => r.url().includes('/api/suites') && r.request().method() === 'POST');
  await page.getByRole('button', { name: label, exact: true }).click();
  const r = await response;
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
