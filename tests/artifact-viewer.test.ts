import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { ResultPresentation, PreviewOpened } from '../packages/contracts/src/artifact-viewer.ts';
import { readAttemptResult } from '../apps/server/src/features/configured-runs.ts';
import { projectResult } from '../apps/server/src/features/artifact-viewer.ts';
import { seedArtifactRun } from './artifact-fixtures.ts';

let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
let fixture: Awaited<ReturnType<typeof seedArtifactRun>>;
let root: string;
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/artifact-viewer-'));
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool, token: 'test' }); url = await app.listen({ host: '127.0.0.1', port: 0 }); fixture = await seedArtifactRun(url);
});
afterAll(async () => { await app?.close(); await pool?.end(); await database?.stop(); });

test('saved HTTP projections render each kind and only publish primary and declared files', async () => {
  for (const record of fixture.records) {
    const response = await fetch(url + record.resultUrl); expect(response.status).toBe(200);
    const presentation = ResultPresentation.parse(await response.json()); expect(presentation.kind).toBe(record.kind);
    expect(JSON.stringify(presentation)).not.toContain('diagnostics');
    if (presentation.kind === 'text') { expect(presentation.text).toContain('Full answer <script>'); expect(presentation.text.length).toBeGreaterThan(100_000); expect(presentation.text).not.toBe('Short summary only'); }
    if (presentation.kind === 'image') expect(presentation.images[0]?.kind).toBe('image');
    if (presentation.kind === 'browser') expect(presentation.recording.kind).toBe('video');
    const extra = presentation.outputs.find((file) => file.download.name === 'extra.txt'); expect(extra?.kind).toBe('text');
    if (extra?.kind === 'text') expect(await (await fetch(url + extra.textUrl)).json()).toEqual({ text: 'Declared extra <b>plain text</b>' });
    for (const file of record.artifacts) {
      const download = await fetch(`${url}/api/configured-runs/${fixture.run.runId}/artifacts/${file.id}`);
      expect(download.headers.get('content-type')).toBe('application/octet-stream'); expect(download.headers.get('content-disposition')).toContain('attachment');
      expect(Buffer.from(await download.arrayBuffer()).toString('base64')).toBe(file.base64);
    }
    const diagnostic = record.artifacts.find((file) => file.kind === 'diagnostic');
    expect((await fetch(url + record.resultUrl.replace('/result', `/files/${diagnostic?.id}/text`))).status).toBe(404);
    expect((await fetch(url + record.resultUrl.replace('/result', `/files/${randomUUID()}/media`))).status).toBe(404);
    expect((await fetch(url + record.resultUrl.replace('/result', '/files/not-an-id/text'))).status).toBe(400);
  }
  const first = fixture.records[0], second = fixture.records[1]; if (!first || !second) throw new Error();
  expect((await fetch(url + first.resultUrl.replace('/result', `/files/${second.artifacts[0]?.id}/text`))).status).toBe(404);
});

test('neutral projection rejects malformed bytes and unsafe supplied URLs without leaking IDs', async () => {
  const record = fixture.records[0]; if (!record) throw new Error();
  const saved = await readAttemptResult(pool, fixture.run.runId, record.attemptId);
  const neutral = await projectResult(saved, { names: 'neutral', artifact: (_id, purpose) => `/cards/file/${purpose}`, html: () => '/cards/preview' });
  expect(JSON.stringify(neutral)).not.toContain(record.attemptId); expect(JSON.stringify(neutral)).not.toContain('extra.txt');
  await expect(projectResult(saved, { names: 'neutral', artifact: () => '//attacker', html: () => '/cards/preview' })).rejects.toThrow();
  const answer = saved.artifacts.find((file) => file.metadata.name === 'answer.txt'); if (!answer) throw new Error(); answer.bytes = Buffer.from([0xc3, 0x28]);
  const invalid = await projectResult(saved, { names: 'neutral', artifact: (_id, purpose) => `/cards/file/${purpose}`, html: () => '/cards/preview' });
  expect(invalid.outputs.filter((file) => file.kind === 'unsupported')).toHaveLength(2);
  const imageRecord = fixture.records.find((item) => item.kind === 'image'); if (!imageRecord) throw new Error();
  const images = await readAttemptResult(pool, fixture.run.runId, imageRecord.attemptId);
  const image = images.artifacts.find((file) => file.metadata.kind === 'image'); if (!image) throw new Error(); image.bytes = image.bytes.subarray(0, 24);
  const malformed = await projectResult(images, { names: 'neutral', artifact: (_id, purpose) => `/cards/file/${purpose}`, html: () => '/cards/preview' });
  expect(malformed.kind === 'image' && malformed.images[0]?.kind).toBe('unsupported');
});

test('HTTP preview actions validate input and scope every capability to its attempt', async () => {
  const html = fixture.records.find((record) => record.kind === 'html');
  const other = fixture.records.find((record) => record.kind === 'text');
  if (!html || !other) throw new Error();
  const preview = html.resultUrl.replace('/result', '/preview');
  const send = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const opened = await send(preview, {}); expect(opened.status).toBe(200);
  const result = PreviewOpened.parse(await opened.json());
  expect((await send(`${preview}/${result.previewId}/input`, { kind: 'click', x: 960, y: 0 })).status).toBe(400);
  expect((await send(`${preview}/${result.previewId}/input`, { kind: 'key', key: 'Control+L' })).status).toBe(400);
  expect((await send(other.resultUrl.replace('/result', `/preview/${result.previewId}/input`), { kind: 'refresh' })).status).toBe(503);
  expect((await send(`${preview}/${result.previewId}/input`, { kind: 'refresh' })).status).toBe(200);
  expect((await fetch(`${url}${preview}/${result.previewId}`, { method: 'DELETE', headers: { origin: url } })).status).toBe(204);
  expect((await send(`${preview}/${result.previewId}/input`, { kind: 'refresh' })).status).toBe(503);
});

test('result projection survives a real database restart', async () => {
  const record = fixture.records[0]; if (!record) throw new Error();
  const original = await (await fetch(url + record.resultUrl)).json();
  await app.close(); await pool.end(); await database.stop();
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool, token: 'test' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  expect(await (await fetch(url + record.resultUrl)).json()).toEqual(original);
});
