import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { Definition, SuiteContent, SuiteHistory, SuiteList, SuiteView } from '../packages/contracts/src/suites.ts';
import { definition } from './suite-fixtures.ts';

let root: string;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/suites-'));
  database = await startDatabase(join(root, 'postgres'));
  const pools = await Promise.all([connectDatabase(database.url), connectDatabase(database.url)]);
  const [first, second] = pools; if (!first || !second) throw new Error('Missing database pool');
  pool = first; await second.end();
  app = await createApp({ pool }); url = await app.listen({ port: 0, host: '127.0.0.1' });
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

test('suite history survives database restart', async () => {
  const created = await create();
  await app.close(); await pool.end(); await database.stop();
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool }); url = await app.listen({ port: 0, host: '127.0.0.1' });
  expect(SuiteView.parse(await (await fetch(`${url}/api/suites/${created.content.suiteId}`)).json())).toEqual(created);
  expect(SuiteHistory.parse(await (await fetch(`${url}/api/suites/${created.content.suiteId}/history`)).json())).toEqual([created.content]);
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
  }
  const title = '日本語 😀 e\u0301\n';
  const created = await create({ ...definition(), title });
  expect(created.content.definition.title).toBe(title);
});
