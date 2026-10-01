import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gradingFixture, canary, png } from '../grading-fixtures.ts';

async function seed(baseURL: string | undefined) {
  if (!baseURL) throw new Error('Missing server URL');
  const fixture = await gradingFixture(baseURL); await fixture.finish(); return fixture;
}
test('navigate pinned anonymous tasks, grade all controls, skip, clear, reload, and inspect safe media', async ({ page, browser, baseURL }) => {
  const fixture = await seed(baseURL);
  const paths: string[] = [], bodies: string[] = [];
  await page.route('**/api/**', async (route) => {
    const response = await route.fetch();
    paths.push(new URL(response.url()).pathname);
    if (response.headers()['content-type']?.includes('application/json')) bodies.push(await response.text());
    await route.fulfill({ response });
  });
  await page.goto('/?view=grading');
  await page.getByRole('article').filter({ hasText: fixture.value.title }).getByRole('button', { name: 'Grade results' }).click();
  await expect(page.getByRole('heading', { name: 'First task', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Grading tasks' })).not.toContainText('Excluded task');
  expect(paths.filter((path) => path.includes('/tasks/'))).toHaveLength(1);
  const results = page.getByRole('region', { name: 'Task grading' });
  await expect(results.getByRole('article')).toHaveCount(4);
  await expect(results).toContainText('Execution failed'); await expect(results).toContainText('Execution was skipped');
  const completed = results.getByRole('article').filter({ has: page.getByRole('group', { name: 'stars-5', exact: true }) });
  const card = completed.first();
  const stars = card.getByRole('group', { name: 'stars-5', exact: true });
  const slider = card.getByRole('group', { name: 'slider-10', exact: true });
  const thumbs = card.getByRole('group', { name: 'thumbs', exact: true });
  await expect(slider.getByRole('button', { name: 'Save grade' })).toBeDisabled();
  await expect(slider).toContainText('Ungraded');
  await stars.getByRole('radio', { name: '4 stars' }).check(); await stars.getByRole('button', { name: 'Save grade' }).click(); await expect(stars).toContainText('Saved grade 80/100');
  await slider.getByRole('combobox', { name: 'Exact score' }).selectOption('0'); await slider.getByRole('button', { name: 'Save grade' }).click(); await expect(slider).toContainText('Saved grade 0/100');
  await slider.getByRole('slider').focus(); await slider.getByRole('slider').press('ArrowRight'); await slider.getByRole('button', { name: 'Save grade' }).click(); await expect(slider).toContainText('Saved grade 10/100');
  await thumbs.getByRole('radio', { name: 'Thumbs down' }).check(); await thumbs.getByRole('button', { name: 'Save grade' }).click(); await expect(thumbs).toContainText('Saved grade 0/100');
  const equal = completed.nth(1).getByRole('group', { name: 'stars-5', exact: true });
  await equal.getByRole('radio', { name: '4 stars' }).check(); await equal.getByRole('button', { name: 'Save grade' }).click(); await expect(equal).toContainText('Saved grade 80/100');
  await slider.getByRole('button', { name: 'Skip', exact: true }).click(); await expect(slider.getByRole('status')).toHaveText('Skipped');
  await slider.getByRole('button', { name: 'Clear', exact: true }).click(); await expect(slider.getByRole('status')).toHaveText('Ungraded');
  await page.screenshot({ path: '.artifacts/blind-grading-cards.png', fullPage: true });
  const sessionURL = page.url();
  await page.reload(); await expect(stars).toContainText('Saved grade 80/100'); await expect(slider.getByRole('status')).toHaveText('Ungraded');
  await expect(results.locator('script, iframe')).toHaveCount(0);
  await page.getByRole('link', { name: /^Image task/ }).click();
  await expect(page.getByRole('heading', { name: 'Image task', exact: true })).toBeVisible();
  await page.getByText('View result', { exact: true }).first().click();
  const image = page.getByRole('img', { name: 'Result file', exact: true }).first();
  await expect(image).toBeVisible(); await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth)).toBe(1);
  const source = await image.getAttribute('src'); if (!source) throw new Error('Missing image URL');
  expect(await (await page.request.get(source)).body()).toEqual(png);
  const imageURL = page.url(); await page.reload(); await expect(page).toHaveURL(imageURL); await page.getByText('View result', { exact: true }).first().click(); await expect(image).toBeVisible();
  await page.getByRole('link', { name: /^HTML task/ }).click();
  await page.getByText('View result', { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Open interactive preview' })).toBeVisible();
  await page.getByText('HTML source', { exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('link', { name: /^Result file \(/ }).first().click();
  const download = await downloadEvent, path = await download.path(); if (!path) throw new Error('Missing download');
  expect(download.suggestedFilename()).toBe('result.bin'); expect((await readFile(path)).toString()).toContain('<script>'); await expect(page).not.toHaveTitle('executed');
  await page.getByRole('link', { name: /^Browser task/ }).click();
  await page.getByText('View result', { exact: true }).first().click();
  const video = page.locator('video').first(); await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element) => element instanceof HTMLVideoElement && element.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((element) => { if (element instanceof HTMLVideoElement) return element.play(); });
  await expect.poll(() => video.evaluate((element) => element instanceof HTMLVideoElement && element.currentTime)).toBeGreaterThan(0);
  const foreign = await browser.newContext(); const otherPage = await foreign.newPage();
  await otherPage.goto(sessionURL); await expect(otherPage.getByRole('alert')).toHaveText('Not found');
  expect((await foreign.request.get(new URL(source, baseURL).toString())).status()).toBe(404); await foreign.close();
  expect(paths.every((path) => path === '/api/access/session' || path.startsWith('/api/blind-grading'))).toBe(true);
  const transport = bodies.join('\n');
  for (const forbidden of [canary, fixture.run.runId, fixture.input.runtimeId, fixture.suite.content.contentId, ...fixture.assignment.attempts.map((attempt) => attempt.attemptId)]) expect(transport).not.toContain(forbidden);
});

test('a lost save replays once and a conflicting tab must reload before another edit', async ({ page, context, baseURL }) => {
  const fixture = await seed(baseURL);
  await page.goto('/?view=grading');
  await page.getByRole('article').filter({ hasText: fixture.value.title }).getByRole('button', { name: 'Grade results' }).click();
  const stars = page.getByRole('group', { name: 'stars-5', exact: true }).first();
  await expect(stars).toBeVisible();
  const second = await context.newPage(); await second.goto(page.url());
  const secondStars = second.getByRole('group', { name: 'stars-5', exact: true }).first(); await expect(secondStars).toBeVisible();
  let dropped = false;
  await page.route('**/api/blind-grading/*/judgments', async (route) => {
    if (!dropped) { dropped = true; expect((await route.fetch()).status()).toBe(200); await route.abort('failed'); }
    else await route.continue();
  });
  await stars.getByRole('radio', { name: '5 stars' }).check(); await stars.getByRole('button', { name: 'Save grade' }).click();
  await expect(stars.getByRole('alert')).toBeVisible(); await stars.getByRole('button', { name: 'Retry exact save' }).click(); await expect(stars).toContainText('Saved grade 100/100');
  await secondStars.getByRole('radio', { name: '1 star', exact: true }).check(); await secondStars.getByRole('button', { name: 'Save grade' }).click();
  await expect(secondStars.getByRole('alert')).toContainText('changed in another tab'); await expect(secondStars.getByRole('button', { name: 'Save grade' })).toBeDisabled();
  await secondStars.getByRole('button', { name: 'Reload saved judgment' }).click(); await expect(secondStars).toContainText('Saved grade 100/100');
  await secondStars.getByRole('radio', { name: '1 star', exact: true }).check(); await secondStars.getByRole('button', { name: 'Save grade' }).click(); await expect(secondStars).toContainText('Saved grade 20/100');
  await page.reload(); await expect(stars).toContainText('Saved grade 20/100'); await second.close();
});

test('a saved judgment survives a failed progress refresh and progress can retry without another save', async ({ page, baseURL }) => {
  const fixture = await seed(baseURL);
  await page.goto('/?view=grading');
  await page.getByRole('article').filter({ hasText: fixture.value.title }).getByRole('button', { name: 'Grade results' }).click();
  const stars = page.getByRole('group', { name: 'stars-5', exact: true }).first();
  await expect(stars).toBeVisible();
  const session = new URL(page.url()).searchParams.get('grading');
  if (!session) throw new Error('Missing grading session');
  let failRefresh = true, saves = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/judgments')) saves++; });
  await page.route(`**/api/blind-grading/${session}`, async (route) => {
    if (failRefresh) { failRefresh = false; await route.abort('failed'); }
    else await route.continue();
  });
  await stars.getByRole('radio', { name: '4 stars' }).check();
  await stars.getByRole('button', { name: 'Save grade' }).click();
  await expect(stars).toContainText('Saved grade 80/100');
  await expect(page.getByRole('alert')).toContainText('Saved progress could not be refreshed');
  await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(page.getByRole('link', { name: /^First task/ })).toContainText('1 graded · 0 skipped · 5 ungraded');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(saves).toBe(1);
  await page.reload();
  await expect(stars).toContainText('Saved grade 80/100');
});
