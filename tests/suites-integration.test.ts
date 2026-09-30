import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { executeRun, deliverSaved, retryReports, uploadReport } from '../apps/runner/src/runner.ts';
import { durableWrite, Progress } from '../apps/runner/src/spool.ts';
import { Definition, PinnedSuiteTask, SuiteContent, SuiteHistory, SuiteList, SuiteView } from '../packages/contracts/src/suites.ts';
import { Report, Snapshot } from '../packages/contracts/src/runner.ts';
import { contentDigest } from '../packages/contracts/src/canonical.ts';
import { definition } from './suite-fixtures.ts';

let root: string;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
const token = 'suite-runner-secret-'.repeat(4);
const legacy = Report.parse({ protocol: 1, reportId: randomUUID(), runId: randomUUID(), source: 'fixture', createdAt: '2026-01-01T00:00:00.000Z', task: { title: 'Legacy', prompt: 'Preserve this old task' }, entrants: ['gpt-6-luna', 'gpt-6-sol'].map((model) => ({ model, attemptId: randomUUID(), cliVersion: 'fixture', outcome: { kind: 'succeeded', text: 'Legacy answer' } })) });
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/suites-'));
  database = await startDatabase(join(root, 'postgres'));
  const oldPool = new pg.Pool({ connectionString: database.url });
  await oldPool.query(await readFile(new URL('../db/migrations/001-text-comparison.sql', import.meta.url), 'utf8'));
  const { acceptReport } = await import('../apps/server/src/features/runs.ts');
  await acceptReport(oldPool, legacy); await oldPool.end();
  const pools = await Promise.all([connectDatabase(database.url), connectDatabase(database.url)]);
  const [first, second] = pools; if (!first || !second) throw new Error('Missing database pool');
  pool = first; await second.end();
  app = await createApp({ pool, token }); url = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => { await app?.close(); await pool?.end(); await database?.stop(); });
async function post(path: string, body: unknown, origin = url) {
  return fetch(url + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function create(value = definition()) {
  const response = await post('/api/suites', { definition: value }); expect(response.status).toBe(200);
  return SuiteView.parse(await response.json());
}
async function save(previous: SuiteView, change: 'minor' | 'revision', value = previous.content.definition) {
  const response = await post(`/api/suites/${previous.content.suiteId}`, { expectedContentId: previous.content.contentId, change, definition: value }); expect(response.status).toBe(200);
  return SuiteView.parse(await response.json());
}

test('nested edits append whole content, explicit minor/new revision labels persist, and old content is immutable', async () => {
  const created = await create();
  expect(created.assessment).toEqual({ kind: 'ready' });
  const value = created.content.definition, task = value.categories[0]?.tasks[0];
  if (!task) throw new Error('Missing task');
  const edited: Definition = { ...value, title: 'Revised title', description: 'Revised description', categories: value.categories.map((category) => ({ ...category, title: 'Revised category', tasks: category.tasks.map((task) => ({ ...task, title: 'Revised task', prompt: 'New prompt', kind: 'text-editing' satisfies typeof task.kind })) })), evaluation: { ...value.evaluation, criteria: value.evaluation.criteria.map((criterion) => ({ ...criterion, title: 'Revised criterion', instructions: 'New criterion guidance', control: 'slider-10' satisfies typeof criterion.control })), rankingRules: value.evaluation.rankingRules.map((rule) => ({ ...rule, title: 'Revised rule', instructions: 'New rule guidance' })) }, materials: { kind: 'repository' satisfies 'repository', url: 'https://example.com/materials.git', requestedRef: 'v1' } };
  const minor = await save(created, 'minor', edited);
  expect([minor.content.revision, minor.content.ordinal]).toEqual([1, 2]);
  expect(minor.content.definition).toEqual(edited);
  const revised = await save(minor, 'revision', { ...edited, categories: [], evaluation: { ...edited.evaluation, criteria: [], rankingRules: [] }, materials: { kind: 'none' } });
  expect([revised.content.revision, revised.content.ordinal]).toEqual([2, 3]); expect(revised.assessment.kind).toBe('incomplete');
  expect(SuiteView.parse(await (await fetch(`${url}/api/suites/${created.content.suiteId}`)).json())).toEqual(revised);
  expect(SuiteContent.parse(await (await fetch(`${url}/api/suites/${created.content.suiteId}/contents/${created.content.contentId}`)).json())).toEqual(created.content);
  expect(SuiteHistory.parse(await (await fetch(`${url}/api/suites/${created.content.suiteId}/history`)).json()).map((content) => [content.revision, content.ordinal])).toEqual([[2, 3], [1, 2], [1, 1]]);
  expect(SuiteList.parse(await (await fetch(url + '/api/suites')).json())).toContainEqual({ suiteId: created.content.suiteId, title: edited.title, revision: 2, ordinal: 3 });
  await expect(pool.query('UPDATE suite_contents SET definition = $1 WHERE id = $2', [{}, created.content.contentId])).rejects.toThrow('Immutable');
  await expect(pool.query('DELETE FROM suite_contents WHERE id = $1', [created.content.contentId])).rejects.toThrow('Immutable');
  const other = await create();
  await expect(pool.query('UPDATE suites SET current_content_id = $1 WHERE id = $2', [other.content.contentId, created.content.suiteId])).rejects.toThrow('suite_current_content');
});

test('two saves on one exact base serialize to one success, one conflict, and no orphan content', async () => {
  const created = await create();
  const responses = await Promise.all(['First', 'Second'].map((title) => post(`/api/suites/${created.content.suiteId}`, { expectedContentId: created.content.contentId, change: 'minor', definition: { ...created.content.definition, title } })));
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const current = SuiteView.parse(await (await fetch(`${url}/api/suites/${created.content.suiteId}`)).json());
  expect(current.content.ordinal).toBe(2);
  expect((await pool.query('SELECT count(*)::int AS count FROM suite_contents WHERE suite_id = $1', [created.content.suiteId])).rows).toEqual([{ count: 2 }]);
  expect((await post(`/api/suites/${created.content.suiteId}`, { expectedContentId: created.content.contentId, change: 'revision', definition: created.content.definition })).status).toBe(409);
});

test('HTTP boundary separates incomplete drafts from malformed input and rejects foreign authority', async () => {
  const created = await create();
  const path = `/api/suites/${created.content.suiteId}`;
  const command = { expectedContentId: created.content.contentId, change: 'minor', definition: created.content.definition };
  for (const body of [{ ...command, change: undefined }, { ...command, change: 'auto' }, { ...command, expectedContentId: undefined }, { ...command, definition: { ...created.content.definition, categories: [{ id: randomUUID(), title: '', tasks: [{ id: randomUUID(), title: '', prompt: '', kind: 'wrong', criterionIds: [] }] }] } }]) expect((await post(path, body)).status).toBe(400);
  for (const target of ['/api/suites', path]) {
    expect((await post(target, command, 'http://evil.invalid')).status).toBe(403);
    expect((await post(target, command, '')).status).toBe(403);
  }
  expect((await app.inject({ method: 'GET', url: path, headers: { host: 'evil.invalid:1234' } })).statusCode).toBe(403);
  expect((await fetch(`${url}/api/suites/${randomUUID()}`)).status).toBe(404);
  expect((await fetch(`${url}/api/suites/${created.content.suiteId}/contents/${randomUUID()}`)).status).toBe(404);
  expect((await fetch(`${url}/api/suites/${randomUUID()}/history`)).status).toBe(404);
  expect((await post(`/api/suites/${randomUUID()}`, command)).status).toBe(404);
  expect((await post('/api/suites', { definition: { ...created.content.definition, description: 'x'.repeat(1_000_000) } })).status).toBe(413);
  expect((await pool.query('SELECT count(*)::int AS count FROM suite_contents WHERE suite_id = $1', [created.content.suiteId])).rows).toEqual([{ count: 1 }]);
  const incomplete = await save(created, 'minor', { ...created.content.definition, title: '' });
  expect(incomplete.assessment.kind).toBe('incomplete');
});

test('pinned file executes after later edits, observes snapshot before first subprocess, and uploads/replays original inputs', async () => {
  const created = await create();
  const task = created.content.definition.categories[0]?.tasks[0]; if (!task) throw new Error('Missing task');
  const file = join(root, 'pinned.json'); await durableWrite(file, { content: created.content, taskId: task.id });
  await save(created, 'minor', { ...created.content.definition, title: 'Changed after export', categories: created.content.definition.categories.map((category) => ({ ...category, tasks: category.tasks.map((task) => ({ ...task, prompt: 'FIXTURE_FAIL' })) })), evaluation: { ...created.content.definition.evaluation, rankingRules: [] } });
  const pinned = PinnedSuiteTask.parse(JSON.parse(await readFile(file, 'utf8')));
  const models: ['gpt-6-luna', 'gpt-6-sol'] = ['gpt-6-luna', 'gpt-6-sol'];
  const execution = executeRun({ source: 'fixture', stateRoot: join(root, 'pinned-runner'), pinned, models, timeoutMs: 10_000 });
  models.reverse();
  const completed = await execution;
  expect(completed.report.protocol).toBe(2);
  if (completed.report.protocol !== 2) throw new Error('Missing snapshot');
  expect(completed.report.snapshot.origin).toEqual({ kind: 'suite', content: created.content, taskId: task.id });
  expect(completed.report.entrants.map((entrant) => entrant.model)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
  expect(completed.report.entrants.map((entrant) => entrant.outcome.kind)).toEqual(['succeeded', 'succeeded']);
  const observed = Progress.parse(JSON.parse(await readFile(join(completed.directory, 'version', 'observed-input.json'), 'utf8')));
  expect(observed.protocol).toBe(2);
  if (observed.protocol !== 2) throw new Error('Missing snapshot before subprocess');
  expect(observed.snapshot).toEqual(completed.report.snapshot); expect(observed.attempts.map((attempt) => attempt.kind)).toEqual(['pending', 'pending']);
  await deliverSaved(completed.directory, { url, token });
  const saved = Report.parse((await pool.query('SELECT report FROM runs WHERE id = $1', [completed.report.runId])).rows[0].report);
  expect(saved).toEqual(completed.report);
  await uploadReport(completed.report, { url, token });
  await expect(pool.query('UPDATE runs SET report = $1 WHERE id = $2', [{}, completed.report.runId])).rejects.toThrow('Immutable');
  await expect(pool.query('DELETE FROM runs WHERE id = $1', [completed.report.runId])).rejects.toThrow('Immutable');
  const tampered = { ...completed.report, task: { ...completed.report.task, prompt: 'Tampered' } };
  expect((await fetch(url + '/api/runner/reports', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(tampered) })).status).toBe(400);
  const changedContent = { ...created.content, definition: { ...created.content.definition, title: 'Falsely labeled historical version' } };
  changedContent.digest = contentDigest({ schemaVersion: 1, definition: changedContent.definition });
  const { digest: _digest, ...snapshotBody } = completed.report.snapshot;
  const changedBody = { ...snapshotBody, origin: { kind: 'suite', content: changedContent, taskId: task.id } };
  const forged = Report.parse({ ...completed.report, runId: randomUUID(), reportId: randomUUID(), snapshot: Snapshot.parse({ ...changedBody, digest: contentDigest(changedBody) }) });
  await expect(uploadReport(forged, { url, token })).rejects.toThrow('409');
}, 120_000);

test('unsupported tasks, materials and incomplete suites fail before creating runner state', async () => {
  const created = await create();
  const task = created.content.definition.categories[0]?.tasks[0]; if (!task) throw new Error('Missing task');
  const stateRoot = join(root, 'refused'); await mkdir(stateRoot);
  const unsupported = await save(created, 'minor', { ...created.content.definition, materials: { kind: 'repository', url: 'https://example.com/materials', requestedRef: 'main' } });
  await expect(executeRun({ source: 'fixture', stateRoot, models: ['gpt-6-luna', 'gpt-6-sol'], pinned: { content: unsupported.content, taskId: task.id } })).rejects.toThrow('only text-generation');
  expect(await readdir(stateRoot)).toEqual([]);
});

test('valid worst-case escaped report content is accepted without widening authoring limits', async () => {
  const value = definition(), task = value.categories[0]?.tasks[0]; if (!task) throw new Error('Missing fixture');
  const large = { ...value, categories: value.categories.map((category) => ({ ...category, tasks: Array.from({ length: 4 }, (_, index) => ({ ...task, id: index === 0 ? task.id : randomUUID(), title: String(index), prompt: '\u0001'.repeat(20_000) })) })) };
  const created = await create(Definition.parse(large));
  const { prepareSnapshot } = await import('../packages/contracts/src/runner.ts');
  const snapshot = prepareSnapshot({ task: { title: 'unused', prompt: 'unused' }, pinned: { content: created.content, taskId: task.id }, models: ['gpt-6-luna', 'gpt-6-sol'], timeoutMs: 1000 });
  const report = Report.parse({ ...legacy, protocol: 2, runId: randomUUID(), reportId: randomUUID(), task: snapshot.task, snapshot, entrants: legacy.entrants.map((entrant) => ({ ...entrant, outcome: { kind: 'succeeded', text: '\u0001'.repeat(100_000) } })) });
  expect(Buffer.byteLength(JSON.stringify(report))).toBeGreaterThan(1_900_000);
  await expect(uploadReport(report, { url, token })).resolves.toMatchObject({ accepted: true });
});

test('legacy database migration, legacy spool replay, suite history and snapshots survive restart', async () => {
  const legacyDirectory = join(root, 'legacy-runner', legacy.runId);
  await durableWrite(join(legacyDirectory, 'report.json'), legacy);
  expect(await retryReports(join(root, 'legacy-runner'), { url, token })).toEqual({ delivered: 1, uncertain: 0 });
  const created = await create();
  await app.close(); await pool.end(); await database.stop();
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool, token }); url = await app.listen({ port: 0, host: '127.0.0.1' });
  expect(Report.parse((await pool.query('SELECT report FROM runs WHERE id = $1', [legacy.runId])).rows[0].report)).toEqual(legacy);
  await expect(uploadReport(legacy, { url, token })).resolves.toMatchObject({ accepted: true });
  expect(SuiteView.parse(await (await fetch(`${url}/api/suites/${created.content.suiteId}`)).json())).toEqual(created);
  expect((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows).toEqual([{ name: '001-text-comparison.sql' }, { name: '002-suites.sql' }]);
});

test('request parser failures remain client errors', async () => {
  for (const [body, type, status] of [['{', 'application/json', 400], ['', 'application/json', 400], ['<suite/>', 'application/xml', 415]] as const) {
    const response = await fetch(url + '/api/suites', { method: 'POST', headers: { origin: url, 'content-type': type }, body });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: status === 415 ? 'Unsupported media type' : 'Invalid request' });
  }
});

test('persisted text rejects NUL and lone surrogates while preserving valid Unicode', async () => {
  for (const invalid of ['\0', '\ud800', '\udfff']) {
    expect((await post('/api/suites', { definition: { ...definition(), title: `bad${invalid}` } })).status).toBe(400);
    const report = { ...legacy, runId: randomUUID(), reportId: randomUUID(), entrants: legacy.entrants.map((entrant) => ({ ...entrant, outcome: { kind: 'succeeded', text: `bad${invalid}` } })) };
    const response = await fetch(url + '/api/runner/reports', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(report) });
    expect(response.status).toBe(400);
  }
  const title = '日本語 😀 e\u0301\n';
  const created = await create({ ...definition(), title });
  expect(created.content.definition.title).toBe(title);
  const report = Report.parse({ ...legacy, runId: randomUUID(), reportId: randomUUID(), entrants: legacy.entrants.map((entrant) => ({ ...entrant, outcome: { kind: 'succeeded', text: title } })) });
  await uploadReport(report, { url, token });
  expect(Report.parse((await pool.query('SELECT report FROM runs WHERE id = $1', [report.runId])).rows[0].report)).toEqual(report);
});
