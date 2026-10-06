import { expect, test } from '@playwright/test';

test('author every task mode, rating control, ranking guidance and materials; save drafts and review history', async ({ page }) => {
  await page.goto('/'); await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await page.getByRole('button', { name: 'New suite' }).click();
  await expect(page.getByRole('region', { name: 'Readiness' })).toContainText('Enter a suite title');
  await page.getByRole('button', { name: 'Create suite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save minor change' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save new revision' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Suite title', exact: true }).fill('All task types');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('All authored fields survive reload');
  for (const [index, control] of ['stars-5', 'slider-10', 'thumbs'].entries()) {
    await page.getByRole('button', { name: 'Add criterion', exact: true }).click();
    const criterion = page.getByRole('group', { name: `Criterion ${index + 1}`, exact: true });
    await criterion.getByRole('textbox', { name: 'Criterion title', exact: true }).fill(`Quality ${index + 1}`);
    await criterion.getByRole('textbox', { name: 'Criterion guidance', exact: true }).fill(`Guidance ${index + 1}`);
    await criterion.getByRole('combobox', { name: 'Rating control', exact: true }).selectOption(control);
    await expect(criterion.getByRole('status')).toHaveText('Ungraded');
    if (control === 'stars-5') {
      await criterion.getByRole('radio', { name: '2 stars', exact: true }).check();
      await expect(criterion.getByRole('status')).toHaveText('Grade: 40 / 100');
    } else if (control === 'slider-10') {
      await criterion.getByRole('button', { name: 'Use zero rating' }).click();
      await expect(criterion.getByRole('status')).toHaveText('Grade: 0 / 100');
      await criterion.getByRole('slider').focus(); await page.keyboard.press('End');
      await expect(criterion.getByRole('status')).toHaveText('Grade: 100 / 100');
      await page.keyboard.press('ArrowLeft');
      await expect(criterion.getByRole('status')).toHaveText('Grade: 90 / 100');
    } else {
      await criterion.getByRole('radio', { name: 'Thumbs down', exact: true }).check();
      await expect(criterion.getByRole('status')).toHaveText('Grade: 0 / 100');
      await criterion.getByRole('radio', { name: 'Thumbs up', exact: true }).check();
      await expect(criterion.getByRole('status')).toHaveText('Grade: 100 / 100');
    }
    await criterion.getByRole('button', { name: 'Clear preview' }).click();
    await expect(criterion.getByRole('status')).toHaveText('Ungraded');
  }
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  const category = page.getByRole('group', { name: 'Category 1', exact: true });
  await category.getByRole('textbox', { name: 'Category title', exact: true }).fill('All modes');
  const kinds = ['text-generation', 'text-editing', 'image-generation', 'image-editing', 'image-understanding', 'html-static', 'html-interactive', 'coding-bugfix', 'coding-feature', 'browser-scenario'];
  for (const [index, kind] of kinds.entries()) {
    await category.getByRole('button', { name: 'Add task', exact: true }).click();
    const task = category.getByRole('group', { name: `Task ${index + 1}`, exact: true });
    await task.getByRole('textbox', { name: 'Task title', exact: true }).fill(`Task ${kind}`);
    await task.getByRole('combobox', { name: 'Task type', exact: true }).selectOption(kind);
    await task.getByRole('textbox', { name: 'Prompt', exact: true }).fill(`Prompt for ${kind}`);
    await task.getByRole('checkbox', { name: 'Quality 1', exact: true }).check();
    await task.getByRole('checkbox', { name: 'Quality 2', exact: true }).check();
  }
  await page.getByRole('button', { name: 'Add ranking rule', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rule title', exact: true }).fill('Tie guidance');
  await page.getByRole('textbox', { name: 'Rule guidance', exact: true }).fill('Use clarity when other qualities tie.');
  await expect(page.getByRole('region', { name: 'Readiness' })).toContainText('Definition ready');
  await page.getByRole('button', { name: 'Save minor change' }).click();
  await expect(page.getByText('Revision 1 · Content 2', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Suite title', exact: true })).toHaveValue('All task types');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('All authored fields survive reload');
  for (const [index, kind] of kinds.entries()) {
    const task = page.getByRole('group', { name: `Task ${index + 1}`, exact: true });
    await expect(task.getByRole('combobox', { name: 'Task type', exact: true })).toHaveValue(kind);
    await expect(task.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(`Prompt for ${kind}`);
    await expect(task.getByRole('checkbox', { name: 'Quality 2', exact: true })).toBeChecked();
  }
  await expect(page.getByRole('textbox', { name: 'Rule guidance', exact: true })).toHaveValue('Use clarity when other qualities tie.');
  await page.getByRole('textbox', { name: 'Suite title', exact: true }).fill('Later local edit');
  await page.getByRole('combobox', { name: 'Materials source', exact: true }).selectOption('repository');
  await page.getByRole('textbox', { name: 'Repository URL', exact: true }).fill('https://secret@example.com/materials');
  await page.getByRole('textbox', { name: 'Requested ref', exact: true }).fill('release-v1');
  await expect(page.getByRole('region', { name: 'Readiness' })).toContainText('Correct these values before saving');
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page.getByRole('alert')).toContainText('without embedded credentials');
  await expect(page.getByRole('textbox', { name: 'Suite title', exact: true })).toHaveValue('Later local edit');
  await page.getByRole('textbox', { name: 'Repository URL', exact: true }).fill('ssh://git@example.com/materials.git');
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page.getByText('Revision 2 · Content 3', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Repository URL', exact: true })).toHaveValue('ssh://git@example.com/materials.git');
  await expect(page.getByRole('textbox', { name: 'Requested ref', exact: true })).toHaveValue('release-v1');
  await page.getByRole('region', { name: 'Suite history' }).getByRole('button', { name: 'Revision 1 · Content 2', exact: true }).click();
  const historical = page.getByRole('region', { name: 'Suite history' });
  await expect(historical).toContainText('All task types');
  await expect(historical).toContainText('Prompt for browser-scenario');
  await expect(historical).toContainText('Use clarity when other qualities tie.');
  await page.screenshot({ path: '.artifacts/suite-authoring-history.png', fullPage: true });
  await page.getByRole('group', { name: 'Criterion 2', exact: true }).getByRole('button', { name: 'Remove criterion and assignments' }).click();
  await expect(page.getByRole('checkbox', { name: 'Quality 2', exact: true })).toHaveCount(0);
  await page.getByRole('group', { name: 'Task 10', exact: true }).getByRole('button', { name: 'Remove task', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Task type', exact: true })).toHaveCount(9);
  await page.getByRole('button', { name: 'Remove rule', exact: true }).click();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  const second = page.getByRole('group', { name: 'Category 2', exact: true });
  await second.getByRole('textbox', { name: 'Category title', exact: true }).fill('Temporary');
  await second.getByRole('button', { name: 'Add task', exact: true }).click();
  await second.getByRole('button', { name: 'Remove category and tasks' }).click();
  await page.getByRole('combobox', { name: 'Materials source', exact: true }).selectOption('none');
  await page.getByRole('button', { name: 'Save minor change' }).click();
  await expect(page.getByText('Revision 2 · Content 4', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Task type', exact: true })).toHaveCount(9);
  await expect(page.getByRole('textbox', { name: 'Criterion title', exact: true })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Rule title', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Materials source', exact: true })).toHaveValue('none');
});

test('stale editor keeps its local changes and reload explicitly adopts the saved version', async ({ page, context }) => {
  await page.goto('/?view=suites'); await page.getByRole('button', { name: 'New suite' }).click();
  await page.getByRole('textbox', { name: 'Suite title', exact: true }).fill('Conflict draft');
  await page.getByRole('button', { name: 'Create suite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
  const second = await context.newPage(); await second.goto(page.url());
  await expect(second.getByRole('textbox', { name: 'Suite title', exact: true })).toHaveValue('Conflict draft');
  await page.getByRole('textbox', { name: 'Suite title', exact: true }).fill('Saved elsewhere');
  await page.getByRole('button', { name: 'Save minor change' }).click();
  await expect(page.getByText('Revision 1 · Content 2', { exact: true }).first()).toBeVisible();
  await second.getByRole('textbox', { name: 'Suite title', exact: true }).fill('Retain my local edits');
  await second.getByRole('button', { name: 'Save new revision' }).click();
  await expect(second.getByRole('alert')).toContainText('Your edits are retained');
  await expect(second.getByRole('textbox', { name: 'Suite title', exact: true })).toHaveValue('Retain my local edits');
  await second.screenshot({ path: '.artifacts/suite-conflict.png', fullPage: true });
  await second.getByRole('button', { name: 'Reload latest and discard local edits' }).click();
  await expect(second.getByRole('textbox', { name: 'Suite title', exact: true })).toHaveValue('Saved elsewhere');
  await second.getByRole('button', { name: 'Save new revision' }).click();
  await expect(second.getByText('Revision 2 · Content 3', { exact: true }).first()).toBeVisible();
  await second.reload(); await expect(second.getByRole('textbox', { name: 'Suite title', exact: true })).toHaveValue('Saved elsewhere');
});
