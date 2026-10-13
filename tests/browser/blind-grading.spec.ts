import { expect, test } from '@playwright/test';
import { gradingFixture, canary, png } from '../grading-fixtures.ts';
import { sessionFor, completedCard } from './ui-helpers.ts';
async function seed(baseURL: string | undefined) {
  if (!baseURL) throw new Error();
  const fixture = await gradingFixture(baseURL);
  await fixture.finish();
  return fixture;
}
test('anonymous picker, autosaved stars, slider zero, thumbs, skip and clear persist; media and foreign access stay scoped', async ({
  page,
  browser,
  baseURL,
}) => {
  const fixture = await seed(baseURL);
  const session = await sessionFor(page, fixture.run.runId);
  const paths: string[] = [],
    bodies: string[] = [];
  await page.route('**/api/**', async (route) => {
    const response = await route.fetch();
    paths.push(new URL(response.url()).pathname);
    if (response.headers()['content-type']?.includes('application/json')) bodies.push(await response.text());
    await route.fulfill({ response });
  });
  await page.goto(`/?view=grading&grading=${session.id}`);
  await expect(page.getByRole('navigation', { name: 'Grading tasks' })).not.toContainText('Excluded task');
  const card = await completedCard(page, 'First task');
  const stars = card.getByRole('group', { name: 'stars-5', exact: true }),
    slider = card.getByRole('group', { name: 'slider-10', exact: true }),
    thumbs = card.getByRole('group', { name: 'thumbs', exact: true });
  await stars.getByRole('radio', { name: '4 of 5', exact: true }).click();
  await expect(stars).toContainText('Saved grade 80/100');
  await slider.getByRole('slider').press('Home');
  await expect(slider).toContainText('Saved grade 0/100');
  await slider.getByRole('slider').press('ArrowRight');
  await expect(slider).toContainText('Saved grade 10/100');
  await thumbs.getByRole('radio', { name: 'Fail', exact: true }).click();
  await expect(thumbs).toContainText('Saved grade 0/100');
  await slider.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(slider.getByRole('status')).toHaveText('Skipped');
  await slider.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(slider.getByRole('status')).toHaveText('Ungraded');
  const equal = await completedCard(page, 'First task', 1);
  await equal.getByRole('radio', { name: '4 of 5', exact: true }).click();
  await expect(equal).toContainText('Saved grade 80/100');
  await page.reload();
  const original = await completedCard(page, 'First task');
  await expect(original).toContainText('Saved grade 80/100');
  await expect(original.getByRole('group', { name: 'slider-10', exact: true }).getByRole('status')).toHaveText(
    'Ungraded',
  );
  await page.getByRole('radio', { name: 'One at a time', exact: true }).click();
  await page
    .locator('.grading-panels>.vb-ep')
    .getByRole('radio', { name: /^Result B(?:, scored)?$/ })
    .click();
  await page.getByRole('radio', { name: 'Compare', exact: true }).click();
  expect(
    await page
      .locator('.grading-panels>.vb-ep')
      .evaluateAll((elements) => elements.map((e) => e.getAttribute('aria-label'))),
  ).toEqual(['Result B', 'Result A']);
  await expect(page.locator('.grading-panels>.vb-ep')).toHaveCount(2);
  const opposite = page.locator('.grading-panels>.vb-ep').last().getAttribute('aria-label');
  await expect(
    page
      .locator('.grading-panels>.vb-ep')
      .first()
      .getByRole('radio', { name: new RegExp(`^${await opposite}(?:, scored)?, open`) }),
  ).toBeDisabled();
  await page.screenshot({ path: '.artifacts/blind-grading-cards.png', fullPage: true });
  const imageCard = await completedCard(page, 'Image task');
  const image = imageCard.getByRole('img', { name: 'Result file', exact: true });
  await expect.poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(1);
  const source = await image.getAttribute('src');
  expect(await (await page.request.get(source!)).body()).toEqual(png);
  await completedCard(page, 'HTML task');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByText('HTML source', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Result preview' })).toContainText('<script>');
  await expect(page).not.toHaveTitle('executed');
  const browserCard = await completedCard(page, 'Browser task');
  const video = browserCard.locator('video');
  await expect.poll(() => video.evaluate((e: HTMLVideoElement) => e.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((e: HTMLVideoElement) => e.play());
  await expect.poll(() => video.evaluate((e: HTMLVideoElement) => e.currentTime)).toBeGreaterThan(0);
  const foreign = await browser.newContext();
  try {
    const other = await foreign.newPage();
    await other.goto(page.url());
    await expect(other.getByRole('alert')).toHaveText('Not found');
    expect((await foreign.request.get(new URL(source!, baseURL).href)).status()).toBe(404);
  } finally {
    await foreign.close();
  }
  expect(paths.every((p) => p === '/api/access/session' || p.startsWith('/api/blind-grading'))).toBe(true);
  for (const forbidden of [
    canary,
    fixture.run.runId,
    fixture.input.runtimeId,
    fixture.suite.content.contentId,
    ...fixture.assignment.attempts.map((a) => a.attemptId),
  ])
    expect(bodies.join('\n')).not.toContain(forbidden);
});
test('lost autosave replays exactly, blocks switching, and stale tabs must explicitly reload', async ({
  page,
  context,
  baseURL,
}) => {
  const fixture = await seed(baseURL);
  const session = await sessionFor(page, fixture.run.runId);
  await page.goto(`/?view=grading&grading=${session.id}`);
  const card = await completedCard(page, 'First task');
  const stars = card.getByRole('group', { name: 'stars-5', exact: true });
  const second = await context.newPage();
  await second.goto(page.url());
  const other = await completedCard(second, 'First task');
  const otherStars = other.getByRole('group', { name: 'stars-5', exact: true });
  let dropped = false;
  await page.route('**/judgments', async (route) => {
    if (!dropped) {
      dropped = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await stars.getByRole('radio', { name: '5 of 5', exact: true }).click();
  await expect(stars.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next task', exact: true })).toBeDisabled();
  await stars.getByRole('button', { name: 'Retry exact save' }).click();
  await expect(stars).toContainText('Saved grade 100/100');
  await otherStars.getByRole('radio', { name: '1 of 5', exact: true }).click();
  await expect(otherStars.getByRole('alert')).toContainText('changed in another tab');
  await otherStars.getByRole('button', { name: 'Reload saved judgment' }).click();
  await expect(otherStars).toContainText('Saved grade 100/100');
  await otherStars.getByRole('radio', { name: '1 of 5', exact: true }).click();
  await expect(otherStars).toContainText('Saved grade 20/100');
  await page.reload();
  await expect(await completedCard(page, 'First task')).toContainText('Saved grade 20/100');
  await second.close();
});
test('failed progress refresh does not undo accepted scores or resend them', async ({ page, baseURL }) => {
  const fixture = await seed(baseURL);
  const session = await sessionFor(page, fixture.run.runId);
  await page.goto(`/?view=grading&grading=${session.id}`);
  const card = await completedCard(page, 'First task');
  let fail = true,
    saves = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/judgments')) saves++;
  });
  await page.route(`**/api/blind-grading/${session.id}`, async (route) => {
    if (fail) {
      fail = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await card.getByRole('radio', { name: '4 of 5', exact: true }).click();
  await expect(card).toContainText('Saved grade 80/100');
  await expect(page.getByRole('alert')).toContainText('progress could not be refreshed');
  await page.getByRole('button', { name: 'Refresh progress' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(saves).toBe(1);
});

test('0–100 slider commits one pointer drag and preserves exact keyboard values after reload', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error();
  const fixture = await gradingFixture(baseURL, '', 'slider-100');
  await fixture.finish();
  const session = await sessionFor(page, fixture.run.runId);
  await page.goto(`/?view=grading&grading=${session.id}`);
  const card = await completedCard(page, 'First task');
  const group = card.getByRole('group', { name: 'slider-100', exact: true }),
    slider = group.getByRole('slider');
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/judgments')) writes++;
  });
  await slider.press('Home');
  await expect(group).toContainText('Saved grade 0/100');
  await slider.press('ArrowRight');
  await expect(group).toContainText('Saved grade 1/100');
  const before = writes,
    box = await slider.boundingBox();
  if (!box) throw new Error();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.73, box.y + box.height / 2, { steps: 8 });
  expect(writes).toBe(before);
  const value = await slider.inputValue();
  await page.mouse.up();
  await expect(group).toContainText(`Saved grade ${value}/100`);
  expect(writes).toBe(before + 1);
  await page.reload();
  await expect(
    (await completedCard(page, 'First task')).getByRole('group', { name: 'slider-100', exact: true }),
  ).toContainText(`Saved grade ${value}/100`);
});
