import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { seedArtifactRun } from '../artifact-fixtures.ts';

test('all saved result viewers render, interact, download, and survive reload', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Missing base URL');
  const fixture = await seedArtifactRun(baseURL);
  await page.goto(`/?view=runs&run=${fixture.run.runId}`);
  const attempts = page.getByRole('region', { name: 'Attempt results' });
  await expect(attempts.getByText('View result', { exact: true })).toHaveCount(5);
  for (const summary of await attempts.getByText('View result', { exact: true }).all()) await summary.click();
  await expect(attempts.getByRole('region', { name: 'Result preview', exact: true })).toHaveCount(5);
  const text = attempts
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'text-generation completed' }) });
  await expect(text).toContainText('Full answer <script>window.viewerEscaped=false</script>');
  expect(await text.locator('.vb-txt').first().textContent()).toHaveLength(153056);
  expect(await page.evaluate(() => 'viewerEscaped' in window)).toBe(false);
  const image = attempts
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'image-generation completed' }) });
  await expect(image.getByRole('img')).toBeVisible();
  await expect.poll(() => image.getByRole('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  const code = attempts
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'coding-feature completed' }) });
  await expect(code.getByRole('region', { name: 'Selected file' })).toContainText(
    'export const result = "<b>escaped</b>";',
  );
  await expect(code.getByRole('region', { name: 'Unified diff' })).toContainText('old');
  await code.getByRole('button', { name: 'removed.txt · deleted' }).click();
  await expect(code.getByRole('region', { name: 'Selected file' })).toContainText('Deleted file.');
  await code.getByRole('button', { name: 'binary.dat · modified' }).click();
  await expect(code.getByRole('region', { name: 'Selected file' })).toContainText('cannot be previewed');
  const browser = attempts
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'browser-scenario completed' }) });
  const video = browser.getByLabel('Browser recording');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  const html = attempts.getByRole('region', { name: 'Interactive HTML preview' });
  await html.getByRole('button', { name: 'Open interactive preview' }).click();
  const frame = page.frameLocator('iframe[title="Interactive HTML preview"]');
  await frame.getByRole('button', { name: 'Count 0' }).click();
  await expect(frame.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await frame.getByLabel('name').fill('Typed through preview');
  await expect(frame.locator('#echo')).toHaveText('Typed through preview');
  expect(await frame.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).toBe('rgb(20, 80, 130)');
  await expect.poll(() => frame.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await expect.poll(() => frame.locator('#probes').evaluate((element) => getComputedStyle(element).letterSpacing)).toBe('3px');
  await expect.poll(() => frame.locator('#echo').evaluate((element) => getComputedStyle(element).wordSpacing)).toBe('2px');
  // Every hostile probe in the bundle is contained by the sandbox and the preview policy.
  await expect(frame.locator('#probes')).toHaveText(
    /^cookie:blocked external:blocked fetch:blocked parent:blocked popup:blocked storage:blocked top:(blocked|attempted)$/,
  );
  expect(new URL(page.url()).searchParams.get('escaped')).toBeNull();
  expect(page.context().pages()).toHaveLength(1);
  const iframe = html.locator('iframe');
  expect(await iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
  await html.getByRole('radio', { name: 'Mobile' }).click();
  await expect(iframe).toHaveAttribute('width', '390');
  await expect.poll(() => frame.locator('body').evaluate(() => window.innerWidth)).toBe(390);
  await html.getByRole('button', { name: 'Reload preview' }).click();
  await expect(frame.getByRole('button', { name: 'Count 0' })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await text.getByRole('link', { name: 'extra.txt (32 bytes)' }).click();
  const download = await downloadEvent;
  const path = await download.path();
  if (!path) throw new Error();
  expect(await readFile(path, 'utf8')).toBe('Declared extra <b>plain text</b>');
  await code.getByRole('button', { name: 'result.ts · added' }).click();
  await code.screenshot({ path: '.artifacts/artifact-code-viewer.png' });
  await html.screenshot({ path: '.artifacts/artifact-html-viewer.png' });
  await browser.screenshot({ path: '.artifacts/artifact-recording-viewer.png' });
  await page.screenshot({ path: '.artifacts/artifact-viewers-expanded.png', fullPage: true });
  await html.getByRole('button', { name: 'Close interactive preview' }).click();
  await page.reload();
  await text.getByText('View result', { exact: true }).click();
  await image.getByText('View result', { exact: true }).click();
  await expect(text).toContainText('Full answer <script>');
  await expect(image.getByRole('img')).toBeVisible();
  await page.screenshot({ path: '.artifacts/artifact-viewers.png', fullPage: true });
});

test('a preview bundle keeps an opaque origin when opened directly and cannot be framed by another origin', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error();
  const fixture = await seedArtifactRun(baseURL);
  const html = fixture.records.find((record) => record.kind === 'html');
  if (!html) throw new Error();
  const opened = await (
    await page.request.post(baseURL + html.resultUrl.replace('/result', '/preview'), { headers: { origin: baseURL }, data: {} })
  ).json();
  // Opened directly (a script-free bundle file, so nothing navigates away), the document still has an opaque origin.
  const direct = await page.goto(baseURL + opened.frameUrl.replace(/index\.html$/, 'extra.txt'));
  expect(direct?.headers()['content-security-policy']).toContain('sandbox allow-scripts allow-forms');
  expect(await page.evaluate(() => window.origin)).toBe('null');
  expect(await page.evaluate(() => { try { return String(localStorage.length); } catch { return 'blocked'; } })).toBe('blocked');
  await page.goto('about:blank');
  await page.setContent(`<iframe title="foreign" src="${baseURL + opened.frameUrl}"></iframe>`);
  await expect.poll(() => page.frames().length).toBe(2);
  await expect(page.frameLocator('iframe[title="foreign"]').getByRole('button', { name: 'Count 0' })).toHaveCount(0);
});
