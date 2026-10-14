import { expect, test } from '@playwright/test';
import { select, saved } from './ui-helpers.ts';
const types = [
  'Text generation',
  'Text editing',
  'Image generation',
  'Image editing',
  'Image understanding',
  'Static HTML page design',
  'Interactive HTML page design',
  'Coding bugfix',
  'Coding new feature',
  'Browser use scenario',
];
test('author all task types, criteria and sources; preserve immutable revisions, validate paths and confirm destructive edits', async ({
  page,
}) => {
  await page.goto('/?view=suites');
  await page.getByRole('button', { name: 'New suite', exact: true }).click();
  await saved(page, 'Create suite');
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.getByRole('textbox', { name: 'Suite title', exact: true }).fill('All task types');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('All fields persist');
  await page.getByRole('tab', { name: /Criteria/ }).click();
  for (const [i, control] of ['Stars, 1 to 5', 'Slider, 0 to 100', 'Thumbs up or down'].entries()) {
    await page.getByRole('button', { name: 'Add criterion', exact: true }).click();
    await page.getByRole('textbox', { name: 'Criterion title', exact: true }).fill(`Quality ${i + 1}`);
    await page.getByRole('textbox', { name: 'Guidance', exact: true }).fill(`Guidance ${i + 1}`);
    await select(page, 'Rating control', control);
    if (i === 0) await page.getByRole('radio', { name: '2 of 5', exact: true }).click();
    if (i === 1) {
      await page.getByRole('slider').focus();
      await page.keyboard.press('End');
      await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
    }
    if (i === 2) await page.getByRole('radio', { name: 'Pass', exact: true }).click();
  }
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await page.getByRole('textbox', { name: 'Category title', exact: true }).fill('All modes');
  for (const [i, type] of types.entries()) {
    await page.getByRole('treeitem', { name: /^All modes/ }).hover();
    await page.getByRole('button', { name: 'Add task to All modes', exact: true }).click();
    await page.getByRole('textbox', { name: 'Task title', exact: true }).fill(`Task ${i + 1}`);
    await select(page, 'Task type', type);
    await page.getByRole('textbox', { name: 'Instructions', exact: true }).fill(`Prompt for ${type}`);
    await page.getByRole('button', { name: /^Quality 1/ }).click();
    await page.getByRole('button', { name: /^Quality 2/ }).click();
  }
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await expect(page.getByText('Ranking guidance', { exact: true })).toHaveCount(0);
  const first = await saved(page, 'Save minor change');
  expect(first.content.revision).toBe(1);
  expect(first.content.definition.categories[0].tasks).toHaveLength(10);
  await page.reload();
  await expect(page.getByLabel('Suite title')).toHaveValue('All task types');
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Task 1');
  for (const [i, type] of types.entries()) {
    await page.getByRole('treeitem', { name: `Task ${i + 1}`, exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^Task type ${type}`) })).toBeVisible();
    await expect(page.getByLabel('Instructions')).toHaveValue(`Prompt for ${type}`);
  }
  await page.getByLabel('Path', { exact: true }).fill('../escape');
  await page.getByRole('button', { name: 'Save minor change' }).click();
  await expect(page.getByRole('alert')).toContainText('contained relative path');
  await page.getByLabel('Path', { exact: true }).fill('tasks/browser');
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page.getByLabel('Sources', { exact: true }).fill('https://secret@example.com/materials');
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page.getByRole('alert')).toContainText('credentials');
  await page.getByLabel('Sources', { exact: true }).fill('https://example.com/materials.git');
  await page.getByLabel('Requested ref').fill('release-v1');
  const second = await saved(page, 'Save new revision');
  expect(second.content.revision).toBe(2);
  await page.getByRole('button', { name: 'History and recovery' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Revision / })).toHaveCount(2);
  await expect(page.getByRole('dialog')).not.toContainText('Content');
  await page.getByRole('button', { name: 'Revision 1', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Historical content' })).toContainText(
    'Prompt for Browser use scenario',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: /Criteria/ }).click();
  await page.getByRole('treeitem', { name: /^Quality 2 / }).click();
  await page.getByRole('button', { name: 'Delete criterion', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete criterion', exact: true }).click();
  await page.getByRole('tab', { name: /Tasks/ }).click();
  await page.getByRole('treeitem', { name: 'Task 10', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Quality 2/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await page.getByLabel('Category title').fill('Temporary');
  await page.getByRole('button', { name: 'Delete category', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete category', exact: true }).click();
  const final = await saved(page, 'Save minor change');
  expect(final.content.definition.categories).toHaveLength(1);
  expect(final.content.definition.categories[0].tasks).toHaveLength(9);
  expect(final.content.definition.evaluation.criteria).toHaveLength(2);
  await page.screenshot({ path: '.artifacts/suite-authoring-design.png', fullPage: true });
});
test('concurrent editor retains local changes until explicit history recovery', async ({ page, context }) => {
  await page.goto('/?view=suites');
  await page.getByRole('button', { name: 'New suite', exact: true }).click();
  await page.getByLabel('Suite title').fill('Conflict draft');
  await saved(page, 'Create suite');
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByLabel('Suite title')).toHaveValue('Conflict draft');
  await page.getByLabel('Suite title').fill('Saved elsewhere');
  await saved(page, 'Save minor change');
  await second.getByLabel('Suite title').fill('Retain local');
  await second.getByRole('button', { name: 'Save new revision' }).click();
  await expect(second.getByRole('alert')).toBeVisible();
  await expect(second.getByLabel('Suite title')).toHaveValue('Retain local');
  await second.getByRole('button', { name: 'History and recovery' }).click();
  await second.getByRole('button', { name: 'Reload latest and discard local edits' }).click();
  await expect(second.getByLabel('Suite title')).toHaveValue('Saved elsewhere');
  await second.close();
});
