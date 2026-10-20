import { completedCard } from './ui-helpers.ts';
import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDatabase } from '../../scripts/local-database.ts';
import { connectDatabase } from '../../apps/server/src/db.ts';
import { createApp } from '../../apps/server/src/app.ts';
import { PreviewOpened } from '../../packages/contracts/src/artifact-viewer.ts';
import { EnrollmentCommand, EnrollmentReceipt } from '../../packages/contracts/src/access.ts';
import { ToolName } from '../../packages/contracts/src/runtime.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { seedArtifactRun } from '../artifact-fixtures.ts';

test('protected dashboard login, rich result access, enrollment and revocation work in Chromium', async ({
  browser,
}) => {
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/access-browser-'));
  const database = await startDatabase(join(root, 'postgres'));
  const pool = await connectDatabase(database.url);
  const app = await createApp({ pool, password: 'browser password', webRoot: resolve('dist/web') });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.addInitScript(() => localStorage.setItem('vb-theme', 'dark'));
    await page.goto(url + '/?view=runtimes');
    await expect(page.getByRole('heading', { name: 'Sign in to Vibe bench' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(10, 22, 48)');
    const bootstrap = await context.request.get(url + '/assets/theme.js');
    expect(bootstrap.status()).toBe(200);
    expect(bootstrap.headers()['content-type']).toContain('javascript');
    const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
    await expect(signIn).toHaveCSS('height', '36px');
    expect((await signIn.boundingBox())!.width).toBe((await page.getByLabel('App password').boundingBox())!.width);
    expect((await context.request.get(url + '/api/runtimes')).status()).toBe(401);
    await page.getByLabel('App password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Password was not accepted.');
    await page.getByLabel('App password').fill('browser password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Runtimes', exact: true })).toBeVisible();
    const sidebar = page.getByRole('complementary');
    const logout = sidebar.getByRole('button', { name: 'Log out', exact: true });
    await expect(logout).toHaveText('Log out');
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(logout).toHaveAccessibleName('Log out');
    await expect(logout.locator('.vb-side-label')).toBeHidden();
    await expect(logout).toHaveCSS('width', '47px');
    await expect(sidebar.getByRole('link', { name: 'Runs', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Light mode', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Collapse', exact: true }).click();
    await expect(logout).toHaveText('');
    await expect(logout).toHaveAccessibleName('Log out');
    await expect(logout).toHaveCSS('width', '47px');
    await logout.hover();
    await expect(page.getByRole('tooltip', { name: 'Log out', exact: true })).toHaveText('Log out');
    await expect(page.locator('.vb-tip.is-shown')).toHaveText('Log out');
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(logout).toHaveText('Log out');
    await page.getByRole('button', { name: 'Connect runtime' }).click();
    await expect(page.getByRole('dialog')).toContainText('Download the runner');
    await expect(page.getByRole('dialog')).toContainText('Install it');
    await expect(page.getByRole('dialog')).toContainText('Pair it with this workspace');
    const command = await page.getByLabel('Enrollment command').inputValue();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy command', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    const payload = EnrollmentCommand.parse(
      JSON.parse(Buffer.from(command.split(' ')[2] ?? '', 'base64url').toString()),
    );
    const secret = randomBytes(32).toString('hex');
    const response = await fetch(url + '/api/worker/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), key: payload.key, credentialId: randomUUID(), secret }),
    });
    const receipt = EnrollmentReceipt.parse(await response.json());
    const registered = await fetch(url + '/api/worker/registrations', {
      method: 'POST', headers: { authorization: `Bearer ${receipt.credentialId}.${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 1, runtimeId: receipt.runtimeId, observation: 1, observedAt: new Date().toISOString(),
        machine: { hostname: 'Browser runtime', os: 'Omarchy 4.0.6', platform: 'linux', architecture: 'x64', logicalCpus: 2, memoryBytes: 1000000 },
        tools: ToolName.options.map((name) => ({ name, availability: { kind: 'available', version: '1.2.3' } })),
        harnesses: { codex: { kind: 'ready', models: ['test-model'] }, claude: { kind: 'not-ready' }, opencodeGo: { kind: 'not-ready' } }, modelPolicy: 'provider-discovered-at-execution' }),
    });
    expect(registered.ok).toBe(true);
    await expect(page.getByRole('heading', { name: 'Runtime connected', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Omarchy 4.0.6');
    await expect(page.getByRole('region', { name: 'Capabilities', exact: true })).toContainText('Codex');
    await page.getByRole('button', { name: 'Copy run command', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('vibe-runner run');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('article').filter({ hasText: 'Browser runtime' })).toContainText('Omarchy 4.0.6');
    await expect(page.getByRole('button', { name: 'Revoke', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke runtime', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    const blocked = await fetch(url + '/api/worker/claims', {
      method: 'POST',
      headers: { authorization: `Bearer ${receipt.credentialId}.${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 2, runtimeId: receipt.runtimeId, requestId: randomUUID() }),
    });
    expect(blocked.status).toBe(401);
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name === 'vibe_session');
    if (!session) throw new Error('No dashboard session');
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe('Strict');
    const fixture = await seedArtifactRun(url, `vibe_session=${session.value}`);
    await page.goto(url + '/?view=runs');
    await page
      .getByRole('article')
      .filter({ hasText: fixture.run.snapshot.content.definition.title })
      .getByRole('link', { name: 'Start grading', exact: true })
      .click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await completedCard(page, 'text-generation');
    await expect(page.getByRole('region', { name: 'Result preview', exact: true })).toContainText(
      'Full answer <script>',
    );
    await page.getByRole('radio', { name: '4 of 5' }).click();
    await expect(page.getByRole('group', { name: 'Clarity', exact: true })).toContainText('Saved grade 80/100');
    await completedCard(page, 'html-interactive');
    const previewResponse = page.waitForResponse(
      (response) => response.url().endsWith('/preview') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    const openedResponse = await previewResponse;
    const opened = PreviewOpened.parse(await openedResponse.json());
    // The sandboxed frame sends no cookies; its capability URL alone loads the bundle in password mode.
    await expect(
      page.frameLocator('iframe[title="Interactive HTML preview"]').getByRole('button', { name: 'Count 0' }),
    ).toBeVisible();
    const previewEndpoint = openedResponse.url();
    const resultLink = page
      .getByRole('region', { name: 'Result preview', exact: true })
      .locator('a[href$="/files/0/download"]');
    const artifactPath = await resultLink.getAttribute('href');
    if (!artifactPath) throw new Error();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse', exact: true }).click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Vibe bench' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await context.request.get(url + `/api/configured-runs/${fixture.run.runId}`)).status()).toBe(401);
    expect((await context.request.get(url + '/api/blind-grading/runs')).status()).toBe(401);
    expect((await context.request.get(url + artifactPath)).status()).toBe(404);
    expect((await context.request.post(previewEndpoint, { headers: { origin: url }, data: {} })).status()).toBe(404);
    // An issued grant stays a capability until it expires; it exposes only the HTML bundle.
    expect((await context.request.get(url + opened.frameUrl)).status()).toBe(200);
  } finally {
    await context.close();
    await app.close();
    await pool.end();
    await database.stop();
  }
});

test('passwordless dashboard creates enrollment through Runtimes', async ({ page }) => {
  await page.goto('/?view=runtimes');
  await expect(page.getByRole('heading', { name: 'Runtimes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect runtime' }).click();
  await expect(page.getByLabel('Enrollment command')).toHaveValue(/^vibe-runner pair /);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
