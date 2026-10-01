import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { seedArtifactRun } from '../artifact-fixtures.ts';
import { PreviewOpened } from '../../packages/contracts/src/artifact-viewer.ts';

test('blind grading displays every rich result and saves judgments with session-only requests', async ({ page, browser, baseURL }) => {
  if (!baseURL) throw new Error();
  const fixture = await seedArtifactRun(baseURL);
  const requests: string[] = [], presentations: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
  await page.route('**/cards/*/result', async (route) => { const response = await route.fetch(); presentations.push(await response.text()); await route.fulfill({ response }); });
  await page.goto('/?view=grading');
  await page.getByRole('article').filter({ hasText: fixture.run.snapshot.content.definition.title }).getByRole('button', { name: 'Grade results' }).click();
  const foreign = await browser.newContext();
  try {
    for (const title of ['text-generation', 'image-generation', 'coding-feature', 'html-interactive', 'browser-scenario']) {
      await page.getByRole('link', { name: new RegExp(`^${title}`) }).click();
      await page.getByText('View result', { exact: true }).click();
      const result = page.getByRole('region', { name: 'Result preview', exact: true });
      await expect(result).toBeVisible();
      if (title === 'text-generation') {
        expect(await result.locator('pre').first().textContent()).toHaveLength(153056);
        const event = page.waitForEvent('download'); await result.getByRole('link', { name: 'Download answer' }).click();
        const download = await event, path = await download.path(); if (!path) throw new Error();
        const answer = fixture.records.flatMap((record) => record.artifacts).find((file) => file.name === 'answer.txt'); if (!answer) throw new Error();
        expect(download.suggestedFilename()).toBe('result.bin');
        expect(await readFile(path)).toEqual(Buffer.from(answer.base64, 'base64'));
      }
      if (title === 'image-generation') await expect.poll(() => result.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
      if (title === 'coding-feature') {
        await expect(result.getByRole('region', { name: 'Selected file' })).toContainText('export const result = "<b>escaped</b>";');
        await expect(result.getByRole('region', { name: 'Unified diff' })).toContainText('-old');
        await result.getByRole('button', { name: 'binary.dat · modified' }).click();
        await expect(result.getByRole('region', { name: 'Selected file' })).toContainText('cannot be previewed');
        await result.getByRole('button', { name: 'result.ts · added' }).click();
      }
      if (title === 'html-interactive') {
        const response = page.waitForResponse((response) => response.url().endsWith('/preview') && response.request().method() === 'POST');
        await result.getByRole('button', { name: 'Open interactive preview' }).click();
        const openedResponse = await response, opened = PreviewOpened.parse(await openedResponse.json());
        const frame = result.getByRole('application'); await expect(frame).toBeVisible();
        const before = await frame.getAttribute('src'), bounds = await frame.boundingBox(); if (!bounds) throw new Error();
        await frame.click({ position: { x: 50 * bounds.width / 960, y: 40 * bounds.height / 640 } });
        await expect.poll(() => frame.getAttribute('src')).not.toBe(before);
        const endpoint = `${openedResponse.url()}/${opened.previewId}`;
        expect((await foreign.request.post(`${endpoint}/input`, { headers: { origin: baseURL }, data: { kind: 'refresh' } })).status()).toBe(404);
        expect((await foreign.request.delete(endpoint, { headers: { origin: baseURL } })).status()).toBe(404);
      }
      if (title === 'browser-scenario') {
        const video = result.getByLabel('Browser recording');
        await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
        await video.evaluate((video: HTMLVideoElement) => video.play());
        await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
      }
      const extra = result.locator('a[href$="/files/0/download"]');
      await expect(extra).toHaveText('Result file (32 bytes)');
      const fileUrl = await extra.getAttribute('href'); if (!fileUrl) throw new Error();
      expect((await foreign.request.get(baseURL + fileUrl)).status()).toBe(404);
      if (title === 'text-generation') {
        const event = page.waitForEvent('download'); await extra.click();
        const download = await event, path = await download.path(); if (!path) throw new Error();
        expect(download.suggestedFilename()).toBe('result.bin'); expect(await readFile(path, 'utf8')).toBe('Declared extra <b>plain text</b>');
      }
      await page.getByRole('radio', { name: '4 stars' }).check();
      await page.getByRole('button', { name: 'Save grade', exact: true }).click();
      await expect(page.getByRole('group', { name: 'Clarity', exact: true })).toContainText('Saved grade 80/100');
      if (title === 'html-interactive') await page.screenshot({ path: '.artifacts/blind-html-grading.png', fullPage: true });
      if (title === 'coding-feature') await page.screenshot({ path: '.artifacts/blind-code-grading.png', fullPage: true });
    }
    await page.reload();
    await expect(page.getByRole('group', { name: 'Clarity', exact: true })).toContainText('Saved grade 80/100');
    expect(requests.every((path) => path.startsWith('/api/blind-grading'))).toBe(true);
    const transport = presentations.join('\n');
    for (const forbidden of [fixture.run.runId, fixture.run.snapshot.runtimeId, ...fixture.records.flatMap((record) => [record.attemptId, ...record.artifacts.map((artifact) => artifact.id)]), 'diagnostics/log.html', 'extra.txt', 'output.png', 'recording.webm']) expect(transport).not.toContain(forbidden);
    expect(transport).toContain('src/result.ts');
    const resultUrl = requests.find((path) => path.endsWith('/result')); if (!resultUrl) throw new Error();
    expect((await foreign.request.get(baseURL + resultUrl)).status()).toBe(404);
  } finally { await foreign.close(); }
});
