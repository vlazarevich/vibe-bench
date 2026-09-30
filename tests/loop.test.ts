import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { childEnvironment, deliverSaved, executeRun, retryReports, uploadReport } from '../apps/runner/src/runner.ts';
import { Evaluation, Runs } from '../packages/contracts/src/evaluation.ts';
import { Report } from '../packages/contracts/src/runner.ts';

let root: string;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
let completed: Awaited<ReturnType<typeof executeRun>>;
const token = 'test-runner-secret-'.repeat(4);

beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/integration-'));
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool, token }); url = await app.listen({ port: 0, host: '127.0.0.1' });
  completed = await executeRun({ source: 'fixture', stateRoot: join(root, 'runner'), models: ['gpt-6-luna', 'gpt-6-sol'], task: { title: 'Unicode: 日本語 🌍', prompt: 'Explain a database index.' } });
});
afterAll(async () => { await app?.close(); await pool?.end(); await database?.stop(); });

async function post(path: string, body: unknown, cookie = '', origin = url) {
  return fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify(body) });
}

test('real fixture subprocesses upload once, changed retry conflicts, and prior input stays immutable', async () => {
  expect(completed.report.entrants.map((e) => e.outcome.kind)).toEqual(['succeeded', 'succeeded']);
  await Promise.all([deliverSaved(completed.directory, { url, token }), deliverSaved(completed.directory, { url, token })]);
  expect((await pool.query('SELECT count(*)::int AS count FROM runs')).rows).toEqual([{ count: 1 }]);
  const changed = Report.parse({ ...completed.report, task: { ...completed.report.task, prompt: 'changed' } });
  await expect(uploadReport(changed, { url, token })).rejects.toThrow('409');
  const saved = z.object({ report: Report }).parse((await pool.query('SELECT report FROM runs')).rows[0]);
  expect(saved.report.task).toEqual(completed.report.task);
  await rm(join(completed.directory, 'receipt.json'));
  expect(await retryReports(join(root, 'runner'), { url, token })).toEqual({ delivered: 1, uncertain: 0 });
  expect((await pool.query('SELECT count(*)::int AS count FROM runs')).rows).toEqual([{ count: 1 }]);
});

test('blind responses omit internal identities, authority is required, choice is atomic and survives database restart', async () => {
  await deliverSaved(completed.directory, { url, token });
  const runsResponse = await fetch(url + '/api/runs');
  const runsText = await runsResponse.text();
  expect(runsText).not.toContain(completed.report.runId);
  expect(runsText).not.toMatch(/gpt-6|cliVersion|attemptId|reportId/);
  const runs = Runs.parse(JSON.parse(runsText));
  const first = runs[0]; if (!first) throw new Error('Missing run');
  const opened = await post('/api/evaluations', { reviewId: first.id });
  expect(opened.status).toBe(200);
  const cookie = opened.headers.get('set-cookie')?.split(';')[0]; if (!cookie) throw new Error('No session authority');
  const blindText = await opened.text();
  expect(blindText).not.toMatch(/gpt-6|cliVersion|attemptId|reportId|runId|identities/);
  const blind = Evaluation.parse(JSON.parse(blindText)); expect(blind.kind).toBe('blind');
  expect((await fetch(url + `/api/evaluations/${blind.sessionId}`)).status).toBe(404);
  expect((await post('/api/evaluations', { reviewId: first.id }, cookie, 'http://evil.invalid')).status).toBe(403);
  const resumed = Evaluation.parse(await (await post('/api/evaluations', { reviewId: first.id }, cookie)).json());
  expect(resumed).toEqual(blind);
  expect((await post(`/api/evaluations/${blind.sessionId}/choice`, { handle: randomUUID() }, cookie)).status).toBe(404);
  const replies = await Promise.all(blind.cards.map((card) => post(`/api/evaluations/${blind.sessionId}/choice`, { handle: card.handle }, cookie)));
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  const accepted = replies.find((r) => r.status === 200); if (!accepted) throw new Error('No accepted choice');
  const revealed = Evaluation.parse(await accepted.json()); if (revealed.kind !== 'revealed') throw new Error('No reveal');
  expect(revealed.identities.map((i) => i.model).sort()).toEqual(['gpt-6-luna', 'gpt-6-sol']);
  expect((await post(`/api/evaluations/${blind.sessionId}/choice`, { handle: revealed.selected }, cookie)).status).toBe(200);
  const selectedIdentity = revealed.identities.find((i) => i.handle === revealed.selected);
  const selectedCard = revealed.cards.find((i) => i.handle === revealed.selected);
  const original = completed.report.entrants.find((i) => i.model === selectedIdentity?.model);
  expect(original?.outcome.kind === 'succeeded' ? original.outcome.text : '').toBe(selectedCard?.text);
  const judgment = await pool.query('SELECT criterion, selected_at IS NOT NULL AS saved FROM evaluation_sessions');
  expect(judgment.rows).toEqual([{ criterion: 'Which answer is better?', saved: true }]);
  for (let restart = 0; restart < 3; restart++) {
    await app.close(); await pool.end(); await database.stop();
    database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
    app = await createApp({ pool, token }); url = await app.listen({ port: 0, host: '127.0.0.1' });
    expect(Evaluation.parse(await (await fetch(url + `/api/evaluations/${blind.sessionId}`, { headers: { cookie } })).json())).toEqual(revealed);
  }
});

test('failed results are retained and never presented as comparable answers', async () => {
  const failed = await executeRun({ source: 'fixture', stateRoot: join(root, 'runner'), models: ['gpt-6-luna', 'gpt-6-sol'], task: { title: 'Failure', prompt: 'FIXTURE_FAIL' } });
  expect(failed.report.entrants.map((e) => e.outcome.kind)).toEqual(['failed', 'failed']);
  await deliverSaved(failed.directory, { url, token });
  const runs = Runs.parse(await (await fetch(url + '/api/runs')).json());
  const failure = runs.find((r) => r.title === 'Failure'); expect(failure?.status).toBe('failed');
  expect((await post('/api/evaluations', { reviewId: failure?.id })).status).toBe(409);
  const progress = await readFile(join(failed.directory, 'progress.json'), 'utf8');
  expect(progress).toContain('finished');
}, 120_000);

test('ingestion rejects missing authority and invalid schemas; uncertain spool does not rerun', async () => {
  expect((await post('/api/runner/reports', completed.report)).status).toBe(401);
  expect((await fetch(url + '/api/runner/reports', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' })).status).toBe(400);
  const uncertain = join(root, 'uncertain'); await mkdir(join(uncertain, randomUUID()), { recursive: true });
  expect(await retryReports(uncertain, { url, token })).toEqual({ delivered: 0, uncertain: 1 });
  process.env.VIBE_RUNNER_TOKEN = 'must-not-reach-child';
  expect(childEnvironment()).not.toHaveProperty('VIBE_RUNNER_TOKEN');
  delete process.env.VIBE_RUNNER_TOKEN;
});
