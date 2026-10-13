import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { seedArtifactRun } from '../artifact-fixtures.ts';
import { sessionFor, select, completedCard } from './ui-helpers.ts';
import { BlindGradingTask } from '../../packages/contracts/src/blind-grading.ts';
test('shared invitation starts a named grading, partial submit freezes scores, reveals entrants and is visible to another grader', async ({
  page,
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error();
  const fixture = await seedArtifactRun(baseURL);
  const runs = await (await page.request.get('/api/dashboard/runs')).json();
  const run = runs.find((r: { id: string }) => r.id === fixture.run.runId);
  await page.goto(`/?view=grading&review=${run.reviewId}`);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start grading', exact: true }).click();
  await page.getByLabel('Your name (optional)').fill('Reviewer');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const card = await completedCard(page, 'text-generation');
  await card.getByRole('radio', { name: '4 of 5', exact: true }).click();
  await expect(card).toContainText('Saved grade 80/100');
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit grading', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('partial grading');
  await page.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Submitted grading' })).toBeVisible();
  await expect(card).toContainText('viewer-fixture');
  await expect(card.getByRole('radio', { name: '4 of 5', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Submitted grading' })).toBeVisible();
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto(`${baseURL}/?view=grading&run=${run.id}`);
    await expect(second.getByRole('table', { name: 'Gradings' })).toContainText('Reviewer');
    await second.getByRole('button', { name: 'View grading', exact: true }).click();
    await expect(second.getByRole('heading', { name: 'Submitted grading' })).toBeVisible();
    await expect(second.getByRole('radio', { name: '4 of 5', exact: true })).toBeDisabled();
  } finally {
    await other.close();
  }
});
test('Results filters, weighted scores, confidence styling, details, dates, model columns and hierarchy use submitted persisted grades', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error();
  const fixture = await seedArtifactRun(baseURL);
  for (let i = 0; i < 21; i++) {
    const session = await sessionFor(page, fixture.run.runId);
    const task = BlindGradingTask.parse(
      await (
        await page.request.get(`/api/blind-grading/${session.id}/tasks/${session.categories[0]!.tasks[0]!.handle}`)
      ).json(),
    );
    const card = task.cards[0]!;
    if (card.kind !== 'completed') throw new Error();
    const judgment = card.judgments[0]!;
    const response = await page.request.post(`/api/blind-grading/${session.id}/judgments`, {
      headers: { origin: baseURL },
      data: {
        card: card.handle,
        criterion: judgment.criterion,
        expectedVersion: 0,
        value: { kind: 'graded', selection: { control: 'stars-5', value: 4 } },
      },
    });
    expect(response.ok()).toBeTruthy();
    expect(
      (
        await page.request.post(`/api/blind-grading/${session.id}/submit`, { headers: { origin: baseURL }, data: {} })
      ).ok(),
    ).toBeTruthy();
  }
  await page.route('**/api/model-catalog', (route) =>
    route.fulfill({
      json: {
        status: 'ready',
        fetchedAt: new Date().toISOString(),
        tier: 'pro',
        message: null,
        models: [
          {
            id: randomUUID(),
            name: 'Viewer Fixture',
            slug: 'viewer-fixture',
            family: 'Test family',
            license: 'open',
            modelClass: 'L',
            parametersBillions: 70,
            contextWindow: 32000,
            aliases: [],
            modalities: ['text'],
          },
        ],
      },
    }),
  );
  await page.goto('/?view=results');
  await select(page, 'Evidence', 'Fixture · no model calls');
  await expect(page.getByRole('treegrid', { name: 'Results scores' })).toBeVisible();
  const score = page.getByRole('button', { name: 'Test family on Text: 80. Show details', exact: true });
  await expect(score).toHaveClass(/is-best/);
  const column = page.getByRole('columnheader', { name: 'Text', exact: true });
  await column.click();
  await expect(column).toHaveAttribute('aria-sort', 'descending');
  await column.click();
  await expect(column).toHaveAttribute('aria-sort', 'none');
  await score.click();
  await expect(page.getByRole('dialog')).toContainText('Grades');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expand all rows' }).click();
  await expect(page.getByRole('rowheader').filter({ hasText: 'Codex' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all rows' }).click();
  await expect(page.getByRole('rowheader').filter({ hasText: 'Codex' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'By suite', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Viewer Fixture' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose model columns' }).click();
  await page.getByRole('checkbox', { name: 'Viewer Fixture', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: 'Viewer Fixture' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose model columns' }).click();
  await page.getByRole('checkbox', { name: 'Viewer Fixture', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'By task', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: /Text editing/ })).toBeVisible();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await page.getByRole('checkbox', { name: 'L', exact: true }).check();
  await page.getByRole('radio', { name: 'Closed', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching grades' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByRole('treegrid')).toBeVisible();
  await page.getByRole('button', { name: /^Results period:/ }).click();
  await page.getByRole('option', { name: 'Yesterday', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No submitted grades yet' })).toBeVisible();
  await page.getByRole('button', { name: /^Results period:/ }).click();
  await page.getByRole('option', { name: 'All time', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('treegrid')).toBeVisible();
  await page.screenshot({ path: '.artifacts/results-design.png', fullPage: true });
});
