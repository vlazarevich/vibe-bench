import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { gradingFixture } from './grading-fixtures.ts';
import { BlindGradingSession, BlindGradingTask, GradingOverview } from '../packages/contracts/src/blind-grading.ts';
import { ResultsData, categoryAverage } from '../packages/contracts/src/results.ts';
import { DashboardRuns, DashboardRuntimes } from '../packages/contracts/src/dashboard.ts';
import { modelCatalog } from '../apps/server/src/features/model-catalog.ts';
import { matchCatalogModel } from '../packages/contracts/src/model-catalog.ts';
import { enrollRuntime, runtimeAuthorization } from './runtime-auth.ts';
let database: Awaited<ReturnType<typeof startDatabase>>,
  pool: Awaited<ReturnType<typeof connectDatabase>>,
  app: Awaited<ReturnType<typeof createApp>>,
  url: string,
  root: string;
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true });
  root = await mkdtemp(resolve('.artifacts/design-'));
  database = await startDatabase(join(root, 'postgres'));
  pool = await connectDatabase(database.url);
  app = await createApp({ pool });
  url = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await database?.stop();
});
async function post(path: string, body: unknown, cookie = '') {
  return fetch(url + path, {
    method: 'POST',
    headers: { origin: url, 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = '') {
  const response = await fetch(url + path, { headers: { cookie } });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}
const results = () =>
  get('/api/results?from=2000-01-01&to=2100-01-01&source=fixture').then((v) => ResultsData.parse(v));

test('multiple named blind gradings freeze partial scores, reveal only after submit, grant read-only views, and survive restart', async () => {
  const fixture = await gradingFixture(url);
  await fixture.finish();
  const runs = DashboardRuns.parse(await get('/api/dashboard/runs'));
  const run = runs.find((r) => r.id === fixture.run.runId)!;
  expect(run.state).toBe('done');
  expect(run.tasks).toEqual({ total: 5, ran: 5, passed: 0 });
  const suites = await get('/api/suites');
  expect(suites.find((s: {suiteId: string}) => s.suiteId === run.suiteId)).toMatchObject({lastRunNumber: run.number});
  const command = { reviewId: run.reviewId, requestId: randomUUID(), graderName: 'Alex' };
  const response = await post('/api/blind-grading', command);
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const session = BlindGradingSession.parse(await response.json());
  expect(BlindGradingSession.parse(await (await post('/api/blind-grading', command, cookie)).json()).id).toBe(
    session.id,
  );
  const before = await results();
  const task = BlindGradingTask.parse(
    await get(`/api/blind-grading/${session.id}/tasks/${session.categories[0]!.tasks[0]!.handle}`, cookie),
  );
  const card = task.cards.find((c) => c.kind === 'completed')!;
  if (card.kind !== 'completed') throw new Error();
  const judgment = card.judgments[0]!;
  expect((await fetch(url + `/api/blind-grading/${session.id}/reveal`, { headers: { cookie } })).status).toBe(409);
  const save = {
    card: card.handle,
    criterion: judgment.criterion,
    expectedVersion: 0,
    value: { kind: 'graded', selection: { control: 'stars-5', value: 1 } },
  };
  const saved = await post(`/api/blind-grading/${session.id}/judgments`, save, cookie);
  expect(saved.status, await saved.clone().text()).toBe(200);
  expect((await results()).observations).toEqual(before.observations);
  expect((await post(`/api/blind-grading/${session.id}/submit`, {}, cookie)).status).toBe(200);
  expect((await post(`/api/blind-grading/${session.id}/submit`, {}, cookie)).status).toBe(200);
  expect(
    (await post(`/api/blind-grading/${session.id}/judgments`, { ...save, expectedVersion: 1 }, cookie)).status,
  ).toBe(409);
  expect(await get(`/api/blind-grading/${session.id}/reveal`, cookie)).toEqual(
    expect.arrayContaining([expect.objectContaining({ card: card.handle, model: 'private-model-harness-marker' })]),
  );
  const after = await results();
  expect(after.observations.length).toBe(before.observations.length + 1);
  expect(after.observations.at(-1)).toMatchObject({ grade: 20, task: 'First task' });
  const second = BlindGradingSession.parse(
    await (await post('/api/blind-grading', { ...command, requestId: randomUUID() }, cookie)).json(),
  );
  expect(second.id).not.toBe(session.id);
  expect(GradingOverview.parse(await get(`/api/configured-runs/${run.id}/gradings`, cookie))).toHaveLength(2);
  const secondTask = BlindGradingTask.parse(await get(`/api/blind-grading/${second.id}/tasks/${second.categories[0]!.tasks[0]!.handle}`, cookie));
  const progress = async () => GradingOverview.parse(await get(`/api/configured-runs/${run.id}/gradings`, cookie)).find((g) => g.id === second.id)!;
  expect(await progress()).toMatchObject({gradedTasks: 0, totalTasks: second.categories.flatMap((c) => c.tasks).length});
  for (const card of secondTask.cards) if (card.kind === 'completed') for (const judgment of card.judgments) {
    const criterion = secondTask.criteria.find((c) => c.handle === judgment.criterion)!;
    expect((await post(`/api/blind-grading/${second.id}/judgments`, {
      card: card.handle, criterion: judgment.criterion, expectedVersion: 0,
      value: {kind: 'graded', selection: {control: criterion.control, value: criterion.control === 'thumbs' ? true : 1}},
    }, cookie)).status).toBe(200);
  }
  expect(await progress()).toMatchObject({gradedTasks: 1});
  const complete = secondTask.cards.find((c) => c.kind === 'completed')!;
  if (complete.kind !== 'completed') throw new Error();
  expect((await post(`/api/blind-grading/${second.id}/judgments`, {
    card: complete.handle, criterion: complete.judgments[0]!.criterion, expectedVersion: 1, value: {kind: 'skipped'},
  }, cookie)).status).toBe(200);
  expect(await progress()).toMatchObject({gradedTasks: 0});
  const granted = await post(`/api/configured-runs/${run.id}/gradings/${session.id}/view`, {});
  expect(granted.status).toBe(200);
  const reader = granted.headers.get('set-cookie')!.split(';')[0]!;
  expect((await get(`/api/blind-grading/${session.id}`, reader)).id).toBe(session.id);
  expect((await post(`/api/blind-grading/${session.id}/judgments`, save, reader)).status).toBe(409);
  expect((await post(`/api/configured-runs/${run.id}/gradings/${second.id}/view`, {}, reader)).status).toBe(404);
  await expect(
    pool.query('UPDATE blind_grading_judgments SET version=version+1 WHERE session_id=$1', [session.id]),
  ).rejects.toThrow();
  await app.close();
  await pool.end();
  await database.stop();
  database = await startDatabase(join(root, 'postgres'));
  pool = await connectDatabase(database.url);
  app = await createApp({ pool });
  url = await app.listen({ host: '127.0.0.1', port: 0 });
  expect((await get(`/api/blind-grading/${session.id}/lifecycle`, cookie)).submittedAt).toBeTruthy();
  expect((await results()).observations).toEqual(after.observations);
});

test('cancelled work retains accepted outcomes and admits partial grading while stopping claims', async () => {
  const fixture = await gradingFixture(url);
  const slot = fixture.assignment.attempts[0]!;
  await fixture.post('/api/worker/attempts', {
    protocol: 1,
    reportId: randomUUID(),
    runtimeId: fixture.input.runtimeId,
    assignmentId: fixture.assignment.assignmentId,
    runId: fixture.run.runId,
    kind: 'started',
    attemptId: slot.attemptId,
    startedAt: new Date().toISOString(),
  });
  await fixture.post('/api/worker/attempts', {
    protocol: 1,
    reportId: randomUUID(),
    runtimeId: fixture.input.runtimeId,
    assignmentId: fixture.assignment.assignmentId,
    runId: fixture.run.runId,
    kind: 'terminal',
    attemptId: slot.attemptId,
    outcome: { kind: 'completed', result: { kind: 'text' }, summary: 'Accepted before cancellation', artifacts: [] },
    artifacts: [],
    observed: { executableVersion: null, model: null },
  });
  expect((await post(`/api/configured-runs/${fixture.run.runId}/cancel`, {})).status).toBe(200);
  expect((await post(`/api/configured-runs/${fixture.run.runId}/cancel`, {})).status).toBe(200);
  const run = DashboardRuns.parse(await get('/api/dashboard/runs')).find((r) => r.id === fixture.run.runId)!;
  expect(run.state).toBe('cancelled');
  expect(await get(`/api/grading-invitations/${run.reviewId}`)).toMatchObject({ ready: true });
  const response = await post('/api/blind-grading', { reviewId: run.reviewId, requestId: randomUUID() });
  expect(response.status, await response.clone().text()).toBe(200);
  const session = BlindGradingSession.parse(await response.json());
  const tasks = session.categories.flatMap((c) => c.tasks);
  expect(tasks).toHaveLength(1);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  expect((await get(`/api/blind-grading/${session.id}/tasks/${tasks[0]!.handle}`, cookie)).cards).toHaveLength(1);
});

test('an empty canceled run remains ineligible and cannot break another run invitation', async () => {
  const empty = await gradingFixture(url);
  await post(`/api/configured-runs/${empty.run.runId}/cancel`, {});
  const completed = await gradingFixture(url);
  await completed.finish();
  const runs = DashboardRuns.parse(await get('/api/dashboard/runs'));
  const emptyRun = runs.find((r) => r.id === empty.run.runId)!,
    ready = runs.find((r) => r.id === completed.run.runId)!;
  expect(await get(`/api/grading-invitations/${emptyRun.reviewId}`)).toMatchObject({ ready: false });
  expect(await get(`/api/grading-invitations/${ready.reviewId}`)).toMatchObject({ ready: true });
  const listed = await get('/api/blind-grading/runs');
  expect(listed.find((r: { reviewId: string }) => r.reviewId === emptyRun.reviewId).ready).toBe(false);
});

test('heartbeat presence expires, deletion revokes credentials and removes the runtime without deleting saved history', async () => {
  const configuration = await enrollRuntime(url);
  const authorization = runtimeAuthorization(configuration);
  const beat = () =>
    fetch(url + '/api/worker/heartbeat', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: '{}',
    });
  expect((await beat()).status).toBe(200);
  expect(
    DashboardRuntimes.parse(await get('/api/dashboard/runtimes')).find((r) => r.id === configuration.runtimeId)?.state,
  ).toBe('ready');
  await pool.query("UPDATE runtime_presence SET last_seen=now()-interval '1 minute' WHERE runtime_id=$1", [
    configuration.runtimeId,
  ]);
  expect(
    DashboardRuntimes.parse(await get('/api/dashboard/runtimes')).find((r) => r.id === configuration.runtimeId)?.state,
  ).toBe('offline');
  expect((await post(`/api/runtimes/${configuration.runtimeId}/delete`, {})).status).toBe(200);
  expect((await beat()).status).toBe(401);
  expect(
    DashboardRuntimes.parse(await get('/api/dashboard/runtimes')).some((r) => r.id === configuration.runtimeId),
  ).toBe(false);
});

test('Artificial Analysis uses server credential, Pro-to-Free fallback, pagination, exact aliases, daily cache and safe stale fallback', async () => {
  let requests = 0;
  const secret = 'server-only-api-key';
  const transport: typeof fetch = async (input, init) => {
    requests++;
    expect(new Headers(init?.headers).get('x-api-key')).toBe(secret);
    const request = String(input);
    if (!request.includes('/free')) return new Response('{}', { status: 403 });
    const page = Number(new URL(request).searchParams.get('page'));
    return Response.json({
      tier: 'free',
      pagination: { page, total_pages: 2, has_more: page === 1 },
      data: [{ id: `id-${page}`, slug: `model-${page}`, name: `Model ${page}`, model_creator: { name: 'Maker' } }],
    });
  };
  const catalog = modelCatalog(pool, secret, transport);
  const [a, b] = await Promise.all([catalog(), catalog()]);
  expect(a).toEqual(b);
  expect(requests).toBe(3);
  expect(a.models).toHaveLength(2);
  expect(a.models[0]).toMatchObject({ license: 'unknown', modelClass: null });
  expect(JSON.stringify(a)).not.toContain(secret);
  await catalog();
  expect(requests).toBe(3);
  expect(matchCatalogModel('provider/model-1', a.models)?.id).toBe('id-1');
  expect(matchCatalogModel('invented-model-1', a.models)).toBeUndefined();
  await pool.query("UPDATE model_catalog SET fetched_at=now()-interval '2 days'");
  const unavailable = modelCatalog(pool, secret, async () => {
    throw new Error(secret);
  });
  const failed = await unavailable();
  expect(failed.status).toBe('unavailable');
  expect(failed.models).toEqual(a.models);
  expect(JSON.stringify(failed)).not.toContain(secret);
  const pro = modelCatalog(pool, secret, async () =>
    Response.json({
      tier: 'pro',
      pagination: { page: 1, total_pages: 1, has_more: false },
      data: [
        {
          id: 'large',
          slug: 'large',
          name: 'Large',
          model_creator: { name: 'Lab' },
          parameters: { total: 405 },
          licensing: { is_open_weights: true },
          context_window_tokens: 128000,
          modalities: { input: { text: true, image: true }, output: { text: true } },
          openrouter_api_id: 'lab/large',
        },
      ],
    }),
  );
  expect((await pro()).models[0]).toMatchObject({
    modelClass: 'XXL',
    license: 'open',
    contextWindow: 128000,
    aliases: ['lab/large'],
    modalities: ['text', 'image'],
  });
});

test('scores weight suite categories equally and retain zero values', () => {
  const base = { suiteId: 'a', categoryId: 'a', grade: 0 };
  expect(categoryAverage([base, { ...base, grade: 100 }, { ...base, categoryId: 'b', grade: 100 }])).toBe(75);
});

test('grading waits for the run publication transaction before snapshotting stopped results', async () => {
  const fixture = await gradingFixture(url);
  const run = DashboardRuns.parse(await get('/api/dashboard/runs')).find((r) => r.id === fixture.run.runId)!;
  const client = await pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM configured_runs WHERE id=$1 FOR UPDATE', [run.id]);
    for (const slot of fixture.assignment.attempts.slice(0, 2))
      await client.query('INSERT INTO attempt_outcomes(attempt_id,outcome,observed) VALUES($1,$2,$3)', [
        slot.attemptId,
        { kind: 'completed', result: { kind: 'text' }, summary: 'Accepted before stopping', artifacts: [] },
        { executableVersion: null, model: null },
      ]);
    await client.query('INSERT INTO run_abandonments(run_id) VALUES($1)', [run.id]);
    pending = post('/api/blind-grading', { reviewId: run.reviewId, requestId: randomUUID() });
    await expect
      .poll(async () =>
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id, snapshot FROM configured_runs WHERE review_id=%'",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    await client.query('COMMIT');
    const response = await pending;
    expect(response.status).toBe(200);
    const session = BlindGradingSession.parse(await response.json());
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const task = BlindGradingTask.parse(
      await get(`/api/blind-grading/${session.id}/tasks/${session.categories[0]!.tasks[0]!.handle}`, cookie),
    );
    expect(task.cards).toHaveLength(2);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
