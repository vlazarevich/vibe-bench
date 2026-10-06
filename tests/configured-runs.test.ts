import { enrollRuntime, runtimeAuthorization } from './runtime-auth.ts';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { createWorkerApp } from '../apps/server/src/worker-app.ts';
import { createSuite, saveSuite } from '../apps/server/src/features/suites.ts';
import { registerRuntime } from '../apps/server/src/features/runtimes.ts';
import { RuntimeRegistration, ToolName } from '../packages/contracts/src/runtime.ts';
import { ConfiguredRunView, CreateConfiguredRun, RunPreview } from '../packages/contracts/src/configured-runs.ts';
import { AttemptReport, ClaimReceipt, RunAssignment, WORK_BODY_LIMIT } from '../packages/contracts/src/work.ts';
import { Definition } from '../packages/contracts/src/suites.ts';
import { contentDigest } from '../packages/contracts/src/canonical.ts';
import { definition } from './suite-fixtures.ts';

let root: string;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let worker: ReturnType<typeof createWorkerApp>;
let url: string;
let workerUrl: string;
const credentials = new Map<string, string>();
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/configured-runs-'));
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool }); url = await app.listen({ port: 0, host: '127.0.0.1' });
  worker = createWorkerApp({ pool }); workerUrl = await worker.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => { await worker?.close(); await app?.close(); await pool?.end(); await database?.stop(); });
function post(path: string, body: unknown, endpoint = url, headers: Record<string, string> = {}) {
  return fetch(endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(path.startsWith('/api/worker/') ? { authorization: credentials.get(typeof body === 'object' && body !== null && 'runtimeId' in body ? String(body.runtimeId) : '') ?? '' } : { origin: endpoint }), ...headers }, body: JSON.stringify(body) });
}
async function setup(value = definition(), entrants = 2) {
  const runtime = RuntimeRegistration.parse({ protocol: 1, runtimeId: randomUUID(), observation: 1, observedAt: new Date().toISOString(), machine: { platform: 'linux', architecture: 'x64', logicalCpus: 4, memoryBytes: 1_000_000 }, tools: ToolName.options.map((name) => ({ name, availability: { kind: 'unavailable', reason: 'missing' } })), harnesses: { codex: { kind: 'not-ready' }, claude: { kind: 'not-ready' }, opencodeGo: { kind: 'not-ready' } }, modelPolicy: 'provider-discovered-at-execution' });
  await registerRuntime(pool, runtime);
  expect(await (await fetch(url + '/api/runtime-access')).json()).toContainEqual({ runtimeId: runtime.runtimeId, active: false });
  credentials.set(runtime.runtimeId, runtimeAuthorization(await enrollRuntime(url, runtime.runtimeId)));
  const suite = await createSuite(pool, { definition: value });
  const input = CreateConfiguredRun.parse({ requestId: randomUUID(), contentId: suite.content.contentId, runtimeId: runtime.runtimeId, selection: { kind: 'all' }, source: 'fixture', entrants: Array.from({ length: entrants }, (_, i) => ({ id: randomUUID(), harness: 'codex', model: `requested-${i}`, settings: { timeoutMs: 3000 } })) });
  return { suite, input };
}
async function create(input: CreateConfiguredRun) {
  const response = await post('/api/configured-runs', input); expect(response.status, await response.clone().text()).toBe(200); return ConfiguredRunView.parse(await response.json());
}
async function claim(runtimeId: string) {
  const response = await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId }, workerUrl);
  expect(response.status, await response.clone().text()).toBe(200); return RunAssignment.parse(await response.json());
}
function identity(assignment: RunAssignment) { return { protocol: 1, reportId: randomUUID(), runtimeId: assignment.snapshot.runtimeId, assignmentId: assignment.assignmentId, runId: assignment.runId }; }
async function prepare(assignment: RunAssignment) { const report = { ...identity(assignment), preparation: { kind: 'none' } }; expect((await post('/api/worker/preparations', report, workerUrl)).status).toBe(200); return report; }
function terminal(assignment: RunAssignment, ordinal = 0) {
  const attempt = assignment.attempts[ordinal]; if (!attempt) throw new Error('Missing test attempt');
  return AttemptReport.parse({ ...identity(assignment), kind: 'terminal', attemptId: attempt.attemptId, outcome: { kind: 'completed', result: { kind: 'text' }, summary: 'Saved answer', artifacts: [] }, artifacts: [], observed: { executableVersion: 'fixture', model: null } });
}
async function start(assignment: RunAssignment, ordinal = 0) {
  const attempt = assignment.attempts[ordinal]; if (!attempt) throw new Error('Missing test attempt');
  const report = { ...identity(assignment), kind: 'started', attemptId: attempt.attemptId, startedAt: new Date().toISOString() };
  expect((await post('/api/worker/attempts', report, workerUrl)).status).toBe(200); return report;
}

test('preview normalizes category/task unions, pins historical content, and atomically replays create requests', async () => {
  const value = definition(); const category = value.categories[0]; const first = category?.tasks[0]; if (!category || !first) throw new Error('Missing fixture');
  const second = { ...first, id: randomUUID(), title: 'Second' };
  const { input, suite } = await setup(Definition.parse({ ...value, categories: [{ ...category, tasks: [first, second] }] }));
  const selected = CreateConfiguredRun.parse({ ...input, selection: { kind: 'subset', categoryIds: [category.id, category.id], taskIds: [second.id, first.id] } });
  const preview = RunPreview.parse(await (await post('/api/configured-runs/preview', { ...selected, requestId: undefined })).json());
  expect(preview.snapshot.selectedTaskIds).toEqual([first.id, second.id]); expect(preview.matrix.map((cell) => cell.taskId)).toEqual([first.id, first.id, second.id, second.id]);
  await saveSuite(pool, suite.content.suiteId, { expectedContentId: suite.content.contentId, change: 'revision', definition: { ...value, title: 'Changed after preview' } });
  const views = await Promise.all(Array.from({ length: 5 }, () => create(selected)));
  expect(views.every((view) => JSON.stringify(view) === JSON.stringify(views[0]))).toBe(true);
  expect(views[0]?.snapshot).toEqual(preview.snapshot);
  expect((await post('/api/configured-runs', { ...selected, source: 'live' })).status).toBe(409);
  expect((await post('/api/configured-runs/preview', { ...input, requestId: undefined, selection: { kind: 'subset', categoryIds: [], taskIds: [] } })).status).toBe(409);
  expect((await post('/api/configured-runs/preview', { ...input, requestId: undefined, selection: { kind: 'subset', categoryIds: [], taskIds: [randomUUID()] } })).status).toBe(409);
  expect((await post('/api/configured-runs/preview', { ...input, requestId: undefined, runtimeId: randomUUID() })).status).toBe(409);
  await expect(pool.query('UPDATE configured_runs SET snapshot = $1', [{}])).rejects.toThrow('Immutable');
  await expect(pool.query('DELETE FROM configured_attempts')).rejects.toThrow('Immutable');
});

test('claim receipts survive duplicate races, idle replay, mismatched runtime, and runtime capacity', async () => {
  const { input } = await setup();
  const idleRequest = { protocol: 1, runtimeId: input.runtimeId, requestId: randomUUID() };
  expect(await (await post('/api/worker/claims', idleRequest, workerUrl)).json()).toEqual({ kind: 'idle', requestId: idleRequest.requestId });
  const first = await create(input); await create({ ...input, requestId: randomUUID() });
  expect(await (await post('/api/worker/claims', idleRequest, workerUrl)).json()).toEqual({ kind: 'idle', requestId: idleRequest.requestId });
  const request = { ...idleRequest, requestId: randomUUID() };
  const claims = await Promise.all(Array.from({ length: 8 }, () => post('/api/worker/claims', request, workerUrl)));
  expect(claims.map((reply) => reply.status)).toEqual(Array(8).fill(200));
  const receipts = await Promise.all(claims.map(async (reply) => ClaimReceipt.parse(await reply.json())));
  expect(receipts.every((value) => JSON.stringify(value) === JSON.stringify(receipts[0]))).toBe(true);
  expect(RunAssignment.parse(receipts[0]).runId).toBe(first.runId);
  expect((await post('/api/worker/claims', { ...request, runtimeId: randomUUID() }, workerUrl)).status).toBe(401);
  const competing = await Promise.all(Array.from({ length: 8 }, () => post('/api/worker/claims', { ...request, requestId: randomUUID() }, workerUrl)));
  for (const reply of competing) expect(ClaimReceipt.parse(await reply.json()).kind).toBe('idle');
});

test('preparation and per-attempt reports enforce associations, sequencing, immutable terminal outcomes and stable receipts', async () => {
  const { input } = await setup(); const view = await create(input); const assignment = await claim(input.runtimeId);
  const done = terminal(assignment);
  expect((await post('/api/worker/attempts', done, workerUrl)).status).toBe(409);
  const prep = await prepare(assignment);
  const prepReceipt = await (await post('/api/worker/preparations', prep, workerUrl)).json();
  expect(await (await post('/api/worker/preparations', prep, workerUrl)).json()).toEqual(prepReceipt);
  expect((await post('/api/worker/preparations', { ...prep, reportId: randomUUID() }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', done, workerUrl)).status).toBe(409);
  const started = await start(assignment);
  expect((await post('/api/worker/attempts', { ...started, reportId: randomUUID() }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', { ...started, reportId: randomUUID(), attemptId: assignment.attempts[1]?.attemptId }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', { ...done, outcome: { kind: 'skipped', reason: 'Too late', artifacts: [] } }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', { ...done, runtimeId: randomUUID() }, workerUrl)).status).toBe(401);
  expect((await post('/api/worker/attempts', { ...done, attemptId: randomUUID() }, workerUrl)).status).toBe(409);
  const responses = await Promise.all(Array.from({ length: 6 }, () => post('/api/worker/attempts', done, workerUrl)));
  expect(responses.map((reply) => reply.status)).toEqual(Array(6).fill(200));
  const receipts = await Promise.all(responses.map((reply) => reply.json())); expect(receipts.every((item) => JSON.stringify(item) === JSON.stringify(receipts[0]))).toBe(true);
  expect((await post('/api/worker/attempts', { ...done, reportId: randomUUID() }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', { ...done, outcome: { kind: 'failed', reason: 'Overwrite', artifacts: [] } }, workerUrl)).status).toBe(409);
  const skip = { ...terminal(assignment, 1), outcome: { kind: 'skipped', reason: 'Executable missing before start', artifacts: [] } };
  expect((await post('/api/worker/attempts', skip, workerUrl)).status).toBe(200);
  const reopened = ConfiguredRunView.parse(await (await fetch(url + `/api/configured-runs/${view.runId}`)).json());
  expect(reopened.status).toBe('finished'); expect(reopened.attempts.map((attempt) => attempt.state.kind === 'terminal' ? attempt.state.outcome.kind : attempt.state.kind)).toEqual(['completed', 'skipped']);
  expect(await (await post('/api/configured-runs', input)).json()).toEqual(view);
  await expect(pool.query('UPDATE attempt_outcomes SET outcome = $1', [{}])).rejects.toThrow('Immutable');
  await worker.close(); await app.close(); await pool.end(); await database.stop();
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool }); url = await app.listen({ port: 0, host: '127.0.0.1' });
  worker = createWorkerApp({ pool }); workerUrl = await worker.listen({ port: 0, host: '127.0.0.1' });
  expect(await (await post('/api/worker/attempts', done, workerUrl)).json()).toEqual(receipts[0]);
  expect(await (await fetch(url + `/api/configured-runs/${view.runId}`)).json()).toEqual(reopened);
});

test('server persists actual artifact bytes, validates metadata/digests/results, and serves inert downloads', async () => {
  const value = definition(); value.categories.forEach((category) => category.tasks.forEach((task) => { task.kind = 'html-static'; }));
  const { input } = await setup(value, 1); const view = await create(input); const assignment = await claim(input.runtimeId); await prepare(assignment); await start(assignment);
  const bytes = Buffer.from('<html><script>alert(1)</script></html>');
  const metadata = { id: randomUUID(), name: 'index.html', kind: 'html', mediaType: 'text/html', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const report = { ...terminal(assignment), outcome: { kind: 'completed', result: { kind: 'html', entryArtifactId: metadata.id, assetArtifactIds: [] }, summary: 'Built HTML', artifacts: [metadata] }, artifacts: [{ ...metadata, base64: bytes.toString('base64') }] };
  expect((await post('/api/worker/attempts', { ...report, artifacts: [{ ...report.artifacts[0], base64: Buffer.from('bad').toString('base64') }] }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', { ...report, outcome: { ...report.outcome, result: { ...report.outcome.result, entryArtifactId: randomUUID() } } }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', report, workerUrl)).status).toBe(200);
  const downloaded = await fetch(url + `/api/configured-runs/${view.runId}/artifacts/${metadata.id}`);
  expect(downloaded.headers.get('content-type')).toBe('application/octet-stream'); expect(downloaded.headers.get('content-disposition')).toContain('attachment'); expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff'); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
  expect((await fetch(url + `/api/configured-runs/${randomUUID()}/artifacts/${metadata.id}`)).status).toBe(404);
  await expect(pool.query('DELETE FROM configured_artifacts')).rejects.toThrow('Immutable');
});

test('repository manifests are pinned and declared outputs cannot silently disappear from success', async () => {
  const value = definition(); value.materials = { kind: 'repository', url: 'https://example.com/repo.git', requestedRef: 'main' };
  const { input } = await setup(value, 1); await create(input); const assignment = await claim(input.runtimeId); const taskId = assignment.snapshot.selectedTaskIds[0]; if (!taskId) throw new Error('Missing task');
  const manifest = { version: 1, tasks: { [taskId]: { inputs: [], outputs: [{ path: 'answer.txt', kind: 'text' }], browser: null } } };
  const prep = { ...identity(assignment), preparation: { kind: 'repository', commit: 'a'.repeat(40), manifest, manifestDigest: contentDigest(manifest) } };
  expect((await post('/api/worker/preparations', { ...prep, preparation: { ...prep.preparation, manifestDigest: 'b'.repeat(64) } }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/preparations', prep, workerUrl)).status).toBe(200); await start(assignment);
  expect((await post('/api/worker/attempts', terminal(assignment), workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', { ...terminal(assignment), outcome: { kind: 'failed', reason: 'Output missing', artifacts: [] } }, workerUrl)).status).toBe(200);
});

test('both listeners reject browser worker calls and enforce schemas and report body limits', async () => {
  for (const endpoint of [url, workerUrl]) {
    for (const path of ['/api/worker/claims', '/api/worker/preparations', '/api/worker/attempts', '/api/worker/registrations']) {
      expect((await post(path, {}, endpoint, { origin: endpoint })).status).toBe(403);
      expect((await post(path, {}, endpoint, { 'sec-fetch-site': 'same-origin' })).status).toBe(403);
      expect((await post(path, {}, endpoint, { 'sec-fetch-dest': 'document' })).status).toBe(403);
      expect((await post(path, {}, endpoint)).status).toBe(401);
    }
    expect((await post('/api/worker/attempts', { padding: 'x'.repeat(WORK_BODY_LIMIT) }, endpoint)).status).toBe(413);
  }
  expect((await fetch(url + '/api/configured-runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
  expect((await fetch(workerUrl + '/api/configured-runs')).status).toBe(404);
});

test('empty or fabricated required media cannot turn execution into a completed image or recording', async () => {
  for (const taskKind of ['image-generation', 'browser-scenario'] satisfies Array<'image-generation' | 'browser-scenario'>) {
    const value = definition(); value.categories.forEach((category) => category.tasks.forEach((task) => { task.kind = taskKind; }));
    const { input } = await setup(value, 1); await create(input); const assignment = await claim(input.runtimeId); await prepare(assignment); await start(assignment);
    for (const bytes of [Buffer.alloc(0), Buffer.from('This is not image or video data')]) {
      const artifact = { id: randomUUID(), name: taskKind === 'image-generation' ? 'result.png' : 'recording.webm', kind: taskKind === 'image-generation' ? 'image' : 'recording', mediaType: taskKind === 'image-generation' ? 'image/png' : 'video/webm', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      const result = taskKind === 'image-generation' ? { kind: 'image', artifactIds: [artifact.id] } : { kind: 'browser', recordingArtifactId: artifact.id, format: 'webm', screenshotArtifactIds: [] };
      const report = { ...terminal(assignment), outcome: { kind: 'completed', result, summary: 'Generated', artifacts: [artifact] }, artifacts: [{ ...artifact, base64: bytes.toString('base64') }] };
      expect((await post('/api/worker/attempts', report, workerUrl)).status).toBe(409);
    }
  }
});

test('failed preparation is retained, prevents execution, and permits a truthful failed terminal report', async () => {
  const { input } = await setup(undefined, 1); await create(input); const next = await create({ ...input, requestId: randomUUID() }); const assignment = await claim(input.runtimeId);
  expect((await post('/api/worker/preparations', { ...identity(assignment), preparation: { kind: 'failed', reason: 'Repository acquisition failed' } }, workerUrl)).status).toBe(200);
  expect((await post('/api/worker/attempts', { ...identity(assignment), kind: 'started', attemptId: assignment.attempts[0]?.attemptId, startedAt: new Date().toISOString() }, workerUrl)).status).toBe(409);
  expect((await post('/api/worker/attempts', { ...terminal(assignment), outcome: { kind: 'failed', reason: 'Repository acquisition failed', artifacts: [] } }, workerUrl)).status).toBe(200);
  expect((await claim(input.runtimeId)).runId).toBe(next.runId);
});

test('freeform protocol text rejects PostgreSQL-invalid characters and paths at the HTTP boundary', async () => {
  const { input } = await setup();
  expect((await post('/api/configured-runs', { ...input, entrants: input.entrants.map((entrant) => ({ ...entrant, model: 'bad\u0000model' })) })).status).toBe(400);
  await create(input); const assignment = await claim(input.runtimeId); await prepare(assignment);
  expect((await post('/api/worker/attempts', { ...terminal(assignment), outcome: { kind: 'failed', reason: 'bad\uD800reason', artifacts: [] } }, workerUrl)).status).toBe(400);
  expect((await post('/api/worker/attempts', { ...terminal(assignment), artifacts: [{ id: randomUUID(), name: '../outside', kind: 'text', mediaType: 'text/plain', bytes: 0, sha256: 'a'.repeat(64), base64: '' }] }, workerUrl)).status).toBe(400);
});
