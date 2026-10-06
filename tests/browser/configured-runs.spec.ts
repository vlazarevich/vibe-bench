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
  const runtimeId = configuration.runtimeId, criterionId = randomUUID();
  const authorization = runtimeAuthorization(configuration);
  runtimeCredentials.set(runtimeId, authorization);
  const registration = await request.post('/api/worker/registrations', { headers: { authorization }, data: {
    protocol: 1, runtimeId, observation: 1, observedAt: new Date().toISOString(),
    machine: { platform: 'linux', architecture: 'x64', logicalCpus: 2, memoryBytes: 4_000_000_000 },
    tools: ToolName.options.map((name) => ({ name, availability: { kind: 'available', version: '1.2.3' } })),
    harnesses: { codex: { kind: 'ready' }, claude: { kind: 'ready' }, opencodeGo: { kind: 'ready' } }, modelPolicy: 'provider-discovered-at-execution',
  } });
  expect(registration.ok()).toBeTruthy();
  const created = await request.post('/api/suites', { headers: { origin: baseURL }, data: { definition: {
    title: `Run suite ${randomUUID().slice(0, 8)}`, description: 'Saved configuration browser coverage',
    categories: [{ id: randomUUID(), title: 'Writing', tasks: ['Explain', 'Rewrite'].map((title) => ({ id: randomUUID(), title, kind: 'text-generation', prompt: `Original ${title} prompt`, criterionIds: [criterionId] })) },
      { id: randomUUID(), title: 'Review', tasks: [{ id: randomUUID(), title: 'Summarize', kind: 'text-generation', prompt: 'Original summary prompt', criterionIds: [criterionId] }] }],
    evaluation: { conversion: 'rating-control-v1', criteria: [{ id: criterionId, title: 'Clarity', instructions: 'Original clarity guidance', control: 'stars-5' }], rankingRules: [] }, materials: { kind: 'none' },
  } } });
  expect(created.ok()).toBeTruthy();
  return { suite: SuiteView.parse(await created.json()), runtimeId };
}

async function selectSuite(page: Page, suite: SuiteView, runtimeId: string) {
  await page.goto('/?view=runs');
  await page.getByRole('combobox', { name: 'Suite', exact: true }).selectOption(suite.content.suiteId);
  await expect(page.getByRole('combobox', { name: 'Saved version' })).toHaveValue(suite.content.contentId);
  await page.getByRole('combobox', { name: 'Runtime', exact: true }).selectOption(runtimeId);
}

test('preview full and selected tasks, preserve saved inputs across suite edits and reload', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Missing test server URL');
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await expect(page.getByRole('combobox', { name: 'Mode', exact: true })).toHaveValue('live');
  await page.getByRole('textbox', { name: 'Model name', exact: true }).fill('custom-codex-model');
  await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).selectOption('high');
  await page.getByRole('spinbutton', { name: 'Time limit in seconds' }).fill('42');
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  const second = page.getByRole('group', { name: 'Model 2', exact: true });
  await second.getByRole('combobox', { name: 'Runner', exact: true }).selectOption('claude');
  await second.getByRole('textbox', { name: 'Model name', exact: true }).fill('custom-claude-model');
  await second.getByRole('combobox', { name: 'Reasoning effort' }).selectOption('max');
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  const third = page.getByRole('group', { name: 'Model 3', exact: true });
  await third.getByRole('combobox', { name: 'Runner', exact: true }).selectOption('opencode');
  await third.getByRole('textbox', { name: 'Model name', exact: true }).fill('provider/custom-open-model');
  await third.getByRole('textbox', { name: 'Model variant' }).fill('careful');
  await page.getByRole('combobox', { name: 'Mode', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  const plan = page.getByRole('region', { name: 'Execution plan' });
  await expect(plan).toContainText('3 tasks · 3 models · 9 attempts');
  await expect(plan.getByRole('row')).toHaveCount(10);
  await page.getByRole('radio', { name: 'Choose categories or tasks' }).check();
  await expect(plan).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start run', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Choose at least one category or task');
  await page.getByRole('checkbox', { name: 'All tasks in Review', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Explain', exact: true }).check();
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  await expect(plan).toContainText('2 tasks · 3 models · 6 attempts');
  await expect(plan).not.toContainText('Rewrite');
  const responseEvent = page.waitForResponse((response) => response.url().endsWith('/api/configured-runs') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  const saved = ConfiguredRunView.parse(await (await responseEvent).json());
  expect(saved.snapshot.entrants.map((entrant) => entrant.settings)).toEqual([{ timeoutMs: 42_000, reasoningEffort: 'high' }, { timeoutMs: 120_000, effort: 'max' }, { timeoutMs: 120_000, variant: 'careful' }]);
  expect(saved.attempts).toHaveLength(6);
  const stableURL = page.url();
  await expect(page.getByRole('region', { name: 'Saved run' })).toContainText('FIXTURE DEMO · NO MODEL CALLS');
  const edited = await request.post(`/api/suites/${suite.content.suiteId}`, { headers: { origin: baseURL }, data: {
    expectedContentId: suite.content.contentId, change: 'revision', definition: { ...suite.content.definition, title: 'Changed suite',
      categories: suite.content.definition.categories.map((category) => ({ ...category, tasks: category.tasks.map((task) => ({ ...task, prompt: 'Changed prompt' })) })),
      evaluation: { ...suite.content.definition.evaluation, criteria: suite.content.definition.evaluation.criteria.map((criterion) => ({ ...criterion, instructions: 'Changed guidance' })) },
    },
  } });
  expect(edited.ok()).toBeTruthy();
  const latest = SuiteView.parse(await edited.json());
  await page.reload();
  await expect(page.getByRole('heading', { name: suite.content.definition.title, exact: true })).toBeVisible();
  await page.getByText('Saved tasks and evaluation criteria', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved run' })).toContainText('Original Explain prompt');
  await expect(page.getByRole('region', { name: 'Saved run' })).toContainText('Original clarity guidance');
  await expect(page.getByRole('region', { name: 'Saved run' })).not.toContainText('Changed prompt');
  await page.getByText('Saved model settings', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved run' })).toContainText('Time limit 42 seconds');
  expect(page.url()).toBe(stableURL);
  await page.screenshot({ path: '.artifacts/configured-run-snapshot.png', fullPage: true });
  await page.getByRole('button', { name: 'All configured runs', exact: true }).click();
  await page.getByRole('combobox', { name: 'Suite', exact: true }).selectOption(suite.content.suiteId);
  await expect(page.getByRole('combobox', { name: 'Saved version' })).toHaveValue(latest.content.contentId);
  await page.getByRole('combobox', { name: 'Saved version' }).selectOption(suite.content.contentId);
  await expect(page.getByRole('combobox', { name: 'Saved version' })).toHaveValue(suite.content.contentId);
  await page.getByRole('link', { name: 'Comparisons', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Available runs', exact: true })).toBeVisible();
});

test('missing models and invalid time limits cannot produce a plan or create a run', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Missing test server URL');
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('enter a name for each model');
  await page.getByRole('textbox', { name: 'Model name', exact: true }).fill('custom-model');
  await page.getByRole('spinbutton', { name: 'Time limit in seconds' }).fill('');
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('time limit between 0.1 and 3600 seconds');
  await page.getByRole('button', { name: 'Remove model 1', exact: true }).click();
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Add at least one model');
  await expect(page.getByRole('button', { name: 'Start run', exact: true })).toHaveCount(0);
});

test('retrying a lost create response reopens the same durable run', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Missing test server URL');
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await page.getByRole('textbox', { name: 'Model name', exact: true }).fill('retry-model');
  await page.getByRole('combobox', { name: 'Mode', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  const accepted: ConfiguredRunView[] = [];
  const requests: string[] = [];
  await page.route('**/api/configured-runs', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    requests.push(route.request().postData() ?? '');
    const response = await route.fetch();
    accepted.push(ConfiguredRunView.parse(await response.json()));
    if (accepted.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start run', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved run' })).toBeVisible();
  expect(accepted).toHaveLength(2);
  expect(accepted[0]?.runId).toBe(accepted[1]?.runId);
  expect(requests[0]).toBe(requests[1]);
  await page.reload();
  await expect(page.getByRole('heading', { name: suite.content.definition.title, exact: true })).toBeVisible();
});

test('run management shows terminal reasons and downloads files without executing their content', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('Missing test server URL');
  const { suite, runtimeId } = await seed(request, baseURL);
  await selectSuite(page, suite, runtimeId);
  await page.getByRole('textbox', { name: 'Model name', exact: true }).fill('fixture-result-model');
  await page.getByRole('combobox', { name: 'Mode', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: 'Preview run', exact: true }).click();
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved run' })).toBeVisible();
  const claim = ClaimReceipt.parse(await (await request.post('/api/worker/claims', { headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' }, data: { protocol: 1, runtimeId, requestId: randomUUID() } })).json());
  if (claim.kind !== 'assigned') throw new Error('Expected fixture assignment');
  const identity = { protocol: 1, runtimeId, assignmentId: claim.assignmentId, runId: claim.runId };
  expect((await request.post('/api/worker/preparations', { headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' }, data: { ...identity, reportId: randomUUID(), preparation: { kind: 'none' } } })).ok()).toBeTruthy();
  const artifactBytes = Buffer.from('<script>document.title="unsafe"</script><p>Download only</p>');
  const artifact = { id: randomUUID(), name: 'answer.html', kind: 'html', mediaType: 'text/html', bytes: artifactBytes.length, sha256: createHash('sha256').update(artifactBytes).digest('hex') };
  for (const [index, attempt] of claim.attempts.entries()) {
    if (index === 0) expect((await request.post('/api/worker/attempts', { headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' }, data: { ...identity, reportId: randomUUID(), kind: 'started', attemptId: attempt.attemptId, startedAt: new Date().toISOString() } })).ok()).toBeTruthy();
    const outcome = index === 0 ? { kind: 'completed', result: { kind: 'text' }, summary: '<script>Unsafe markup stays text</script>', artifacts: [artifact] }
      : index === 1 ? { kind: 'skipped', reason: 'Model unavailable. Select a model accessible to this runtime.', artifacts: [] }
        : { kind: 'failed', reason: 'Time limit exceeded. Increase the time limit and create a new run.', artifacts: [] };
    const response = await request.post('/api/worker/attempts', { headers: { authorization: runtimeCredentials.get(runtimeId) ?? '' }, data: { ...identity, reportId: randomUUID(), kind: 'terminal', attemptId: attempt.attemptId, outcome, artifacts: index === 0 ? [{ ...artifact, base64: artifactBytes.toString('base64') }] : [], observed: { executableVersion: null, model: null } } });
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
  const download = await downloadEvent, path = await download.path();
  if (!path) throw new Error('Missing artifact download');
  expect(await readFile(path)).toEqual(artifactBytes);
  await expect(page).not.toHaveTitle('unsafe');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Attempt results' })).toContainText('Model unavailable');
});
