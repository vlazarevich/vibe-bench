import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { ResultPresentation, PreviewOpened } from '../packages/contracts/src/artifact-viewer.ts';
import { BlindGradingRuns, BlindGradingSession, BlindGradingTask, Judgment } from '../packages/contracts/src/blind-grading.ts';
import { seedArtifactRun } from './artifact-fixtures.ts';

let database: Awaited<ReturnType<typeof startDatabase>>, pool: Awaited<ReturnType<typeof connectDatabase>>, app: Awaited<ReturnType<typeof createApp>>, url: string;
let fixture: Awaited<ReturnType<typeof seedArtifactRun>>, session: BlindGradingSession, cookie: string, foreign: string;
const get = (path: string, authority = cookie) => fetch(url + path, { headers: { cookie: authority } });
const post = (path: string, body: unknown, authority = cookie) => fetch(url + path, { method: 'POST', headers: { origin: url, 'content-type': 'application/json', cookie: authority }, body: JSON.stringify(body) });
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); const root = await mkdtemp(resolve('.artifacts/grading-viewer-'));
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url); app = await createApp({ pool, token: 'test' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  fixture = await seedArtifactRun(url);
  const runs = BlindGradingRuns.parse(await (await get('/api/blind-grading/runs', '')).json());
  const run = runs.find((run) => run.title === fixture.run.snapshot.content.definition.title); if (!run) throw new Error();
  const opened = await post('/api/blind-grading', { reviewId: run.reviewId }, '');
  cookie = opened.headers.get('set-cookie')?.split(';')[0] ?? ''; session = BlindGradingSession.parse(await opened.json());
  const other = await post('/api/blind-grading', { reviewId: run.reviewId }, ''); foreign = other.headers.get('set-cookie')?.split(';')[0] ?? '';
});
afterAll(async () => { await app?.close(); await pool?.end(); await database?.stop(); });
function suppliedUrls(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('/api/') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(suppliedUrls);
  if (value && typeof value === 'object') return Object.values(value).flatMap(suppliedUrls);
  return [];
}
test('all rich blind results retain grades, neutral transport and authority on every published file', async () => {
  for (const taskRef of session.categories.flatMap((category) => category.tasks)) {
    const task = BlindGradingTask.parse(await (await get(`/api/blind-grading/${session.id}/tasks/${taskRef.handle}`)).json());
    const card = task.cards[0], criterion = task.criteria[0]; if (!card || card.kind !== 'completed' || !criterion) throw new Error();
    const base = `/api/blind-grading/${session.id}/cards/${card.handle}`;
    const response = await get(`${base}/result`); expect(response.status).toBe(200);
    const result = ResultPresentation.parse(await response.json());
    const transport = JSON.stringify(result) + JSON.stringify(Object.fromEntries(response.headers));
    const permittedContentPaths = result.kind === 'code' ? result.files.map((file) => file.path) : [];
    for (const forbidden of [fixture.run.runId, fixture.run.snapshot.runtimeId, ...fixture.records.flatMap((record) => [record.attemptId, ...record.artifacts.map((artifact) => artifact.id), ...record.artifacts.map((artifact) => artifact.name).filter((name) => !permittedContentPaths.includes(name))])]) expect(transport).not.toContain(forbidden);
    expect((await get(`${base}/result`, '')).status).toBe(404); expect((await get(`${base}/result`, foreign)).status).toBe(404);
    if (result.kind === 'text') { expect(result.text.length).toBeGreaterThan(100_000); expect(result.download?.bytes).toBe(153056); }
    if (result.kind === 'code') expect(result.files.map((file) => file.path)).toContain('src/result.ts');
    expect(result.outputs.length).toBeGreaterThan(0);
    for (const path of suppliedUrls(result).filter((path) => !path.endsWith('/preview'))) {
      expect(path).toMatch(/^\/api\/blind-grading\/[a-f0-9-]+\/cards\/[a-f0-9-]+\/files\/\d+\/(download|text|media)$/);
      const file = await get(path); expect(file.status).toBe(200);
      expect((await get(path, foreign)).status).toBe(404);
      if (path.endsWith('/download')) { expect(file.headers.get('content-disposition')).toBe('attachment; filename="result.bin"'); expect(file.headers.get('content-type')).toBe('application/octet-stream'); }
      await file.arrayBuffer();
    }
    expect((await get(`${base}/files/2/download`)).status).toBe(404);
    const saved = Judgment.parse(await (await post(`/api/blind-grading/${session.id}/judgments`, { card: card.handle, criterion: criterion.handle, expectedVersion: 0, value: { kind: 'graded', selection: { control: 'stars-5', value: 4 } } })).json());
    expect(saved.value.kind === 'graded' && saved.value.grade).toBe(80);
    const replay = BlindGradingTask.parse(await (await get(`/api/blind-grading/${session.id}/tasks/${taskRef.handle}`)).json());
    expect(replay.cards[0]?.kind === 'completed' && replay.cards[0].judgments[0]?.value).toEqual(saved.value);
  }
});
test('HTML capabilities reauthorize open, input and delete and cannot cross sessions', async () => {
  let base = '';
  for (const taskRef of session.categories.flatMap((category) => category.tasks)) {
    const task = BlindGradingTask.parse(await (await get(`/api/blind-grading/${session.id}/tasks/${taskRef.handle}`)).json());
    const card = task.cards.find((card) => card.kind === 'completed' && card.result.kind === 'html');
    if (card) base = `/api/blind-grading/${session.id}/cards/${card.handle}`;
  }
  expect(base).not.toBe('');
  expect((await post(`${base}/preview`, {}, foreign)).status).toBe(404);
  expect((await post(`${base}/preview`, { unexpected: true })).status).toBe(400);
  const opened = PreviewOpened.parse(await (await post(`${base}/preview`, {})).json());
  const html = fixture.records.find((record) => record.kind === 'html'); if (!html) throw new Error();
  const management = html.resultUrl.replace('/result', '/preview');
  const managed = PreviewOpened.parse(await (await post(management, {})).json());
  expect((await post(`${base}/preview`, {})).status).toBe(503);
  expect((await fetch(`${url}${management}/${managed.previewId}`, { method: 'DELETE', headers: { origin: url } })).status).toBe(204);
  const input = `${base}/preview/${opened.previewId}/input`, close = `${base}/preview/${opened.previewId}`;
  expect((await post(input, { kind: 'refresh' }, foreign)).status).toBe(404);
  expect((await fetch(url + close, { method: 'DELETE', headers: { origin: url, cookie: foreign } })).status).toBe(404);
  expect((await post(input, { kind: 'click', x: 50, y: 40 })).status).toBe(200);
  expect((await fetch(url + close, { method: 'DELETE', headers: { origin: url, cookie } })).status).toBe(204);
  expect((await post(input, { kind: 'refresh' })).status).toBe(503);
});
