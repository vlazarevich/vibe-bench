import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDatabase } from '../../scripts/local-database.ts';
import { connectDatabase } from '../../apps/server/src/db.ts';
import { createApp } from '../../apps/server/src/app.ts';
import { EnrollmentCommand, EnrollmentReceipt } from '../../packages/contracts/src/access.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { seedArtifactRun } from '../artifact-fixtures.ts';

test('protected dashboard login, rich result access, enrollment and revocation work in Chromium', async ({ browser }) => {
  await mkdir('.artifacts', { recursive: true }); const root = await mkdtemp(resolve('.artifacts/access-browser-'));
  const database = await startDatabase(join(root, 'postgres')); const pool = await connectDatabase(database.url);
  const app = await createApp({ pool, token: 'test', password: 'browser password', webRoot: resolve('dist/web') });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await page.goto(url + '/?view=runtimes');
    await expect(page.getByRole('heading', { name: 'Sign in to Vibe bench' })).toBeVisible();
    expect((await context.request.get(url + '/api/runtimes')).status()).toBe(401);
    await page.getByLabel('App password').fill('wrong'); await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Password was not accepted.');
    await page.getByLabel('App password').fill('browser password'); await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Runtimes', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add new' }).click();
    const command = await page.getByLabel('Enrollment command').inputValue();
    const payload = EnrollmentCommand.parse(JSON.parse(Buffer.from(command.split(' ')[2] ?? '', 'base64url').toString()));
    const secret = randomBytes(32).toString('hex');
    const response = await fetch(url + '/api/worker/enrollments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), key: payload.key, credentialId: randomUUID(), secret }) });
    const receipt = EnrollmentReceipt.parse(await response.json());
    await page.getByRole('button', { name: 'Refresh runtimes' }).click();
    await expect(page.getByText('Credential active', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(page.getByText('Credential revoked', { exact: false })).toBeVisible();
    const blocked = await fetch(url + '/api/worker/claims', { method: 'POST', headers: { authorization: `Bearer ${receipt.credentialId}.${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocol: 1, runtimeId: receipt.runtimeId, requestId: randomUUID() }) });
    expect(blocked.status).toBe(401);
    const cookies = await context.cookies(); const session = cookies.find((cookie) => cookie.name === 'vibe_session'); if (!session) throw new Error('No dashboard session');
    expect(session.httpOnly).toBe(true); expect(session.sameSite).toBe('Strict');
    const fixture = await seedArtifactRun(url, `vibe_session=${session.value}`);
    await page.goto(url + '/?view=runs');
    await expect(page.getByRole('heading', { name: fixture.run.snapshot.content.definition.title, exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Grading', exact: true }).click();
    await expect(page.getByRole('heading', { name: fixture.run.snapshot.content.definition.title, exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Vibe bench' })).toBeVisible();
    expect((await context.request.get(url + `/api/configured-runs/${fixture.run.runId}`)).status()).toBe(401);
    expect((await context.request.get(url + '/api/blind-grading/runs')).status()).toBe(401);
  } finally { await context.close(); await app.close(); await pool.end(); await database.stop(); }
});

test('passwordless dashboard creates enrollment through Runtimes', async ({ page }) => {
  await page.goto('/?view=runtimes');
  await expect(page.getByRole('heading', { name: 'Runtimes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add new' }).click();
  await expect(page.getByLabel('Enrollment command')).toHaveValue(/^vibe-runtime config /);
});
