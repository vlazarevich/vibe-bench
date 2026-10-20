import { select } from './ui-helpers.ts';
import { enrollRuntime, runtimeAuthorization } from '../runtime-auth.ts';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SuiteView } from '../../packages/contracts/src/suites.ts';
import { ConfiguredRunView } from '../../packages/contracts/src/configured-runs.ts';
import { ToolName } from '../../packages/contracts/src/runtime.ts';
import { ClaimReceipt } from '../../packages/contracts/src/work.ts';

const runtimeCredentials = new Map<string, string>();
async function seed(request: APIRequestContext, baseURL: string) {
  const configuration = await enrollRuntime(baseURL);
  const runtimeId = configuration.runtimeId,
    criterionId = randomUUID();
  const authorization = runtimeAuthorization(configuration);
  runtimeCredentials.set(runtimeId, authorization);
  const registration = await request.post('/api/worker/registrations', {
    headers: { authorization },
    data: {
      protocol: 1,
      runtimeId,
      observation: 1,
      observedAt: new Date().toISOString(),
      machine: { platform: 'linux', architecture: 'x64', logicalCpus: 2, memoryBytes: 4_000_000_000 },
      tools: ToolName.options.map((name) => ({ name, availability: { kind: 'available', version: '1.2.3' } })),
      harnesses: { codex: { kind: 'ready', models: ['catalog-codex-model', 'retry-model', 'fixture-result-model'] }, claude: { kind: 'ready', models: ['catalog-claude-model'] }, opencodeGo: { kind: 'ready' } },
      modelPolicy: 'provider-discovered-at-execution',
    },
  });
  expect(registration.ok()).toBeTruthy();
  const created = await request.post('/api/suites', {
    headers: { origin: baseURL },
    data: {
      definition: {
        title: `Run suite ${randomUUID().slice(0, 8)}`,
        description: 'Saved configuration browser coverage',
        categories: [
          {
            id: randomUUID(),
            title: 'Writing',
            tasks: ['Explain', 'Rewrite'].map((title) => ({
              id: randomUUID(),
              title,
              kind: 'text-generation',
              prompt: `Original ${title} prompt`,
              criterionIds: [criterionId],
            })),
          },
          {
            id: randomUUID(),
            title: 'Review',
            tasks: [
              {
                id: randomUUID(),
                title: 'Summarize',
                kind: 'text-generation',
                prompt: 'Original summary prompt',
                criterionIds: [criterionId],
              },
            ],
          },
        ],
        evaluation: {
          conversion: 'rating-control-v1',
          criteria: [
            { id: criterionId, title: 'Clarity', instructions: 'Original clarity guidance', control: 'stars-5' },
          ],
          rankingRules: [],
        },
        materials: { kind: 'none' },
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  return { suite: SuiteView.parse(await created.json()), runtimeId };
}

async function selectSuite(page: Page, suite: SuiteView, runtimeId: string) {
  await page.goto('/?view=runs');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await select(page, 'Suite', suite.content.definition.title);
  await select(page, 'Runtime', runtimeId.slice(0, 8));
}
async function create(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/configured-runs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^(Start|Queue) run$/ }).click();
  const r = await response;
  expect(r.status(), await r.text()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return ConfiguredRunView.parse(await r.json());
}
test('create full matrix with dropdown entrants, review pinned history, cancel, and run again', async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error();
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await select(page, 'Model 1', 'catalog-codex-model');
  await select(page, 'Effort 1', 'High');
  await page.getByRole('button', { name: 'Add entrant' }).click();
  await page.locator('#harness-1').click();
  await page.getByRole('option', { name: 'Claude Code', exact: true }).click();
  await select(page, 'Model 2', 'catalog-claude-model');
  await page.locator('#effort-1').click();
  await page.getByRole('option', { name: 'Max', exact: true }).click();
  await expect(page.getByText('Tasks and execution options')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview matrix' })).toHaveCount(0);
  const run = await create(page);
  expect(run.attempts).toHaveLength(6);
  expect(run.snapshot.source).toBe('live');
  expect(run.snapshot.entrants.map((e) => e.settings)).toEqual([
    { timeoutMs: 120000, reasoningEffort: 'high' },
    { timeoutMs: 120000, effort: 'max' },
  ]);
  await request.post(`/api/suites/${suite.content.suiteId}`, {
    headers: { origin: baseURL },
    data: {
      expectedContentId: suite.content.contentId,
      change: 'revision',
      definition: { ...suite.content.definition, title: 'Changed suite' },
    },
  });
  await page.goto(`/?view=runs&run=${run.runId}`);
  await page.getByText('Saved tasks and evaluation criteria', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved run' })).toContainText('Original Explain prompt');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Saved run' })).toContainText(suite.content.definition.title);
  await page.getByRole('button', { name: 'All runs', exact: true }).click();
  const card = page.getByRole('article').filter({ hasText: suite.content.definition.title });
  await card.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(card).toContainText('Cancelled');
  await card.getByRole('button', { name: 'Run again' }).click();
  await expect(page.locator('#model-0')).toContainText('catalog-codex-model');
  await expect(page.getByRole('button', { name: /^Revision Rev 1/ })).toBeVisible();
  await page.screenshot({ path: '.artifacts/new-run-design.png' });
});
test('missing model, unavailable model discovery and no entrants cannot create a run', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error();
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await expect(page.getByRole('button', { name: /^(Start|Queue) run$/ })).toBeDisabled();
  await select(page, 'Model 1', 'catalog-codex-model');
  await select(page, 'Harness 1', 'OpenCode');
  await expect(page.locator('#model-0')).toBeDisabled();
  await expect(page.locator('#model-0')).toContainText('No models');
  await expect(page.getByRole('button', { name: /^(Start|Queue) run$/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove entrant 1' }).click();
  await expect(page.getByRole('button', { name: /^(Start|Queue) run$/ })).toBeDisabled();
});
test('lost create response retries exact immutable request and creates one run', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error();
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await select(page, 'Model 1', 'retry-model');
  const accepted: ConfiguredRunView[] = [],
    bodies: string[] = [];
  await page.route('**/api/configured-runs', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    accepted.push(ConfiguredRunView.parse(await response.json()));
    if (accepted.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: /^(Start|Queue) run$/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await create(page);
  expect(accepted).toHaveLength(2);
  expect(accepted[0]!.runId).toBe(accepted[1]!.runId);
  expect(bodies[0]).toBe(bodies[1]);
  await page.reload();
  await expect(page.getByRole('article').filter({ hasText: suite.content.definition.title })).toHaveCount(1);
});

test('run management shows terminal reasons and downloads files without executing their content', async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Missing test server URL');
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await select(page, 'Model 1', 'fixture-result-model');
  const created = await create(page);
  await page.goto(`/?view=runs&run=${created.runId}`);
  await expect(page.getByRole('region', { name: 'Saved run' })).toBeVisible();
  const claim = ClaimReceipt.parse(
    await (
      await request.post('/api/worker/claims', {
        headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' },
        data: { protocol: 2, runtimeId, requestId: randomUUID() },
      })
    ).json(),
  );
  if (claim.kind !== 'assigned') throw new Error('Expected fixture assignment');
  const identity = { protocol: 2, runtimeId, assignmentId: claim.assignmentId, runId: claim.runId };
  expect(
    (
      await request.post('/api/worker/preparations', {
        headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' },
        data: { ...identity, reportId: randomUUID(), preparation: { kind: 'none' } },
      })
    ).ok(),
  ).toBeTruthy();
  const artifactBytes = Buffer.from('<script>document.title="unsafe"</script><p>Download only</p>');
  const artifact = {
    id: randomUUID(),
    name: 'answer.html',
    kind: 'html',
    mediaType: 'text/html',
    bytes: artifactBytes.length,
    sha256: createHash('sha256').update(artifactBytes).digest('hex'),
  };
  for (const [index, attempt] of claim.attempts.entries()) {
    if (index === 0)
      expect(
        (
          await request.post('/api/worker/attempts', {
            headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' },
            data: {
              ...identity,
              reportId: randomUUID(),
              kind: 'started',
              attemptId: attempt.attemptId,
              startedAt: new Date().toISOString(),
            },
          })
        ).ok(),
      ).toBeTruthy();
    const outcome =
      index === 0
        ? {
            kind: 'completed',
            result: { kind: 'text' },
            summary: '<script>Unsafe markup stays text</script>',
            artifacts: [artifact],
          }
        : index === 1
          ? { kind: 'skipped', reason: 'Model unavailable. Select a model accessible to this runtime.', artifacts: [] }
          : {
              kind: 'failed',
              reason: 'Time limit exceeded. Increase the time limit and create a new run.',
              artifacts: [],
            };
    if (index === 0)
      expect(
        (
          await request.post('/api/worker/artifact-chunks', {
            headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' },
            data: {
              ...identity,
              attemptId: attempt.attemptId,
              artifactId: artifact.id,
              offset: 0,
              base64: artifactBytes.toString('base64'),
            },
          })
        ).ok(),
      ).toBeTruthy();
    const response = await request.post('/api/worker/attempts', {
      headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' },
      data: {
        ...identity,
        reportId: randomUUID(),
        kind: 'terminal',
        attemptId: attempt.attemptId,
        outcome,
        observed: { executableVersion: null, model: null },
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
  const results = page.getByRole('region', { name: 'Attempt results' });
  await expect(results).toContainText('<script>Unsafe markup stays text</script>');
  await expect(results).toContainText('Select a model accessible to this runtime');
  await expect(results).toContainText('Increase the time limit and create a new run');
  await expect(results.locator('script, iframe')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await results.getByRole('link', { name: 'answer.html', exact: true }).click();
  const download = await downloadEvent,
    path = await download.path();
  if (!path) throw new Error('Missing artifact download');
  expect(await readFile(path)).toEqual(artifactBytes);
  await expect(page).not.toHaveTitle('unsafe');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Attempt results' })).toContainText('Model unavailable');
});

test('minor saves replace the revision picker entry; fixture repeats retain hidden API settings and show their source', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error();
  const { suite, runtimeId } = await seed(request, baseURL);
  const response = await request.post(`/api/suites/${suite.content.suiteId}`, {
    headers: { origin: baseURL },
    data: { expectedContentId: suite.content.contentId, change: 'minor', definition: { ...suite.content.definition, description: 'Latest minor edit' } },
  });
  const latest = SuiteView.parse(await response.json());
  await selectSuite(page, suite, runtimeId);
  await page.getByRole('button', { name: /^Revision Rev 1$/ }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Rev 1', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await select(page, 'Model 1', 'catalog-codex-model');
  const fresh = await create(page);
  expect(fresh.snapshot.content.contentId).toBe(latest.content.contentId);
  const input = { requestId: randomUUID(), contentId: latest.content.contentId, runtimeId, source: 'fixture', selection: { kind: 'subset', categoryIds: [], taskIds: [suite.content.definition.categories[0]!.tasks[0]!.id] }, entrants: [{ id: randomUUID(), harness: 'codex', model: 'catalog-codex-model', settings: { timeoutMs: 45000 } }] };
  const fixtureResponse = await request.post('/api/configured-runs', { headers: { origin: baseURL }, data: input });
  expect(fixtureResponse.ok(), await fixtureResponse.text()).toBeTruthy();
  const fixture = ConfiguredRunView.parse(await fixtureResponse.json());
  await request.post(`/api/configured-runs/${fixture.runId}/cancel`, { headers: { origin: baseURL }, data: {} });
  const minorResponse = await request.post(`/api/suites/${suite.content.suiteId}`, {
    headers: { origin: baseURL },
    data: { expectedContentId: latest.content.contentId, change: 'minor', definition: { ...latest.content.definition, description: 'Edited after the original run' } },
  });
  const newer = SuiteView.parse(await minorResponse.json());
  await page.goto(`/?view=runs&run=${fixture.runId}`);
  await page.getByRole('button', { name: 'All runs', exact: true }).click();
  const card = page.getByRole('article').filter({ hasText: 'Cancelled' }).filter({ hasText: suite.content.definition.title });
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  const historyUrl = `**/api/suites/${suite.content.suiteId}/history`;
  await page.route(historyUrl, async (route) => { await historyGate; await route.continue(); });
  await card.getByRole('button', { name: 'Run again' }).click();
  await expect(page.getByRole('button', { name: /^(Start|Queue) run$/ })).toBeDisabled();
  releaseHistory();
  await expect(page.getByRole('dialog')).toContainText('Fixture run · no model calls.');
  const repeated = await create(page);
  expect(repeated.snapshot.content.contentId).toBe(newer.content.contentId);
  expect(repeated.snapshot.content.definition.description).toBe('Edited after the original run');
  expect(repeated.snapshot.source).toBe('fixture');
  expect(repeated.snapshot.selectedTaskIds).toEqual(fixture.snapshot.selectedTaskIds);
  expect(repeated.snapshot.entrants[0]!.settings.timeoutMs).toBe(45000);
  await page.unroute(historyUrl);
  await page.route(historyUrl, (route) => route.abort('failed'));
  await card.getByRole('button', { name: 'Run again' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Start|Queue) run$/ })).toBeDisabled();
});
