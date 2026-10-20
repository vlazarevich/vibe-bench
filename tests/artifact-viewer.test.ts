import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { ResultPresentation, PreviewOpened } from '../packages/contracts/src/artifact-viewer.ts';
import { readAttemptResult } from '../apps/server/src/features/configured-runs.ts';
import { projectResult } from '../apps/server/src/features/artifact-viewer.ts';
import { interactiveHtml, png, seedArtifactRun } from './artifact-fixtures.ts';
import { previewableMedia } from '../apps/server/src/features/media-headers.ts';

let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
let fixture: Awaited<ReturnType<typeof seedArtifactRun>>;
let root: string;
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/artifact-viewer-'));
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool }); url = await app.listen({ host: '127.0.0.1', port: 0 }); fixture = await seedArtifactRun(url);
});
afterAll(async () => { await app?.close(); await pool?.end(); await database?.stop(); });

test('saved HTTP projections render each kind and only publish primary and declared files', async () => {
  for (const record of fixture.records) {
    const response = await fetch(url + record.resultUrl); expect(response.status).toBe(200);
    const presentation = ResultPresentation.parse(await response.json()); expect(presentation.kind).toBe(record.kind);
    expect(JSON.stringify(presentation)).not.toContain('diagnostics');
    if (presentation.kind === 'text') { expect(presentation.text).toContain('Full answer <script>'); expect(presentation.text.length).toBeGreaterThan(100_000); expect(presentation.text).not.toBe('Short summary only'); expect(presentation.download?.bytes).toBe(153056); }
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
  const legacy = await projectResult({ ...saved, artifacts: saved.artifacts.filter((file) => file.metadata.name !== 'answer.txt') }, { names: 'neutral', artifact: (_id, purpose) => `/cards/file/${purpose}`, html: () => '/cards/preview' });
  expect(legacy.kind === 'text' && legacy.download).toBeNull();
  const answer = saved.artifacts.find((file) => file.metadata.name === 'answer.txt'); if (!answer) throw new Error(); answer.bytes = Buffer.from([0xc3, 0x28]);
  const invalid = await projectResult(saved, { names: 'neutral', artifact: (_id, purpose) => `/cards/file/${purpose}`, html: () => '/cards/preview' });
  expect(invalid.outputs.filter((file) => file.kind === 'unsupported')).toHaveLength(2);
  const imageRecord = fixture.records.find((item) => item.kind === 'image'); if (!imageRecord) throw new Error();
  const images = await readAttemptResult(pool, fixture.run.runId, imageRecord.attemptId);
  const image = images.artifacts.find((file) => file.metadata.kind === 'image'); if (!image) throw new Error(); image.bytes = image.bytes.subarray(0, 20);
  const malformed = await projectResult(images, { names: 'neutral', artifact: (_id, purpose) => `/cards/file/${purpose}`, html: () => '/cards/preview' });
  expect(malformed.kind === 'image' && malformed.images[0]?.kind).toBe('unsupported');
});

test('HTML preview grants serve only the granted bundle, without cookies, under a sandbox policy, until expiry', async () => {
  const html = fixture.records.find((record) => record.kind === 'html');
  const other = fixture.records.find((record) => record.kind === 'text');
  if (!html || !other) throw new Error();
  const preview = html.resultUrl.replace('/result', '/preview');
  const send = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await send(preview, { unexpected: true })).status).toBe(400);
  expect((await send(other.resultUrl.replace('/result', '/preview'), {})).status).toBe(404);
  const opened = PreviewOpened.parse(await (await send(preview, {})).json());
  const again = PreviewOpened.parse(await (await send(preview, {})).json());
  expect(again.frameUrl).not.toBe(opened.frameUrl);
  expect(Date.parse(opened.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000);
  const token = opened.frameUrl.split('/')[2] ?? '';
  const bundle = `${url}/preview/${token}/`;
  const entry = await fetch(url + opened.frameUrl);
  expect(entry.status).toBe(200);
  expect(entry.headers.get('content-type')).toContain('text/html');
  const policy = entry.headers.get('content-security-policy') ?? '';
  for (const directive of ['sandbox allow-scripts allow-forms', `script-src ${bundle} `, "connect-src 'none'", "form-action 'none'", "frame-src 'none'", `frame-ancestors ${url}`]) expect(policy).toContain(directive);
  expect(await entry.text()).toBe(interactiveHtml);
  for (const asset of ['assets/style.css?v=1', 'assets/%C3%BC%20wide.css', 'assets/vendor+chunk@1,a=b.css', 'assets/vendor%2Bchunk%401%2Ca%3Db.css', 'assets/probe.js', 'assets/picture.png', 'extra.txt']) {
    const response = await fetch(bundle + asset);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(policy);
  }
  for (const missing of ['diagnostics/log.html', 'assets/missing.js', '..%2f..%2fapi%2fhealth', 'ASSETS/probe.js']) expect((await fetch(bundle + missing)).status).toBe(404);
  expect((await fetch(`${url}/preview/${'A'.repeat(43)}/index.html`)).status).toBe(404);
  expect((await fetch(bundle + 'assets/%E0%A4%A.css')).status).toBe(400);
  expect((await fetch(`${url}/preview/short/index.html`)).status).not.toBe(200);
  const hashes = (await pool.query('SELECT token_hash FROM preview_grants')).rows.map((row) => row.token_hash);
  expect(hashes).not.toContain(token);
  expect(hashes).toContain(createHash('sha256').update(token).digest('hex'));
  expect((await fetch(url + '/')).headers.get('content-security-policy')).toContain(`frame-src ${url}/preview/`);
  await pool.query("UPDATE preview_grants SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [createHash('sha256').update(token).digest('hex')]);
  expect((await fetch(url + opened.frameUrl)).status).toBe(404);
  expect((await fetch(url + again.frameUrl)).status).toBe(200);
});

test('preview links fit the longest multibyte artifact names', () => {
  const name = '漢'.repeat(240);
  const frameUrl = `/preview/${'A'.repeat(43)}/${encodeURIComponent(name)}`;
  expect(PreviewOpened.parse({ frameUrl, expiresAt: new Date().toISOString() }).frameUrl).toBe(frameUrl);
});

test('media is checked from headers only and bounded by declared dimensions', () => {
  const pngOf = (width: number, height: number) => { const bytes = Buffer.from(png); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes; };
  expect(previewableMedia(png, 'image/png')).toBe(true);
  expect(previewableMedia(pngOf(0, 1), 'image/png')).toBe(false);
  expect(previewableMedia(pngOf(10_000, 4001), 'image/png')).toBe(false);
  expect(previewableMedia(png.subarray(0, 20), 'image/png')).toBe(false);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03]);
  expect(previewableMedia(jpeg, 'image/jpeg')).toBe(true);
  expect(previewableMedia(jpeg.subarray(0, 10), 'image/jpeg')).toBe(false);
  const vp8l = Buffer.alloc(30); vp8l.write('RIFF', 0); vp8l.write('WEBP', 8); vp8l.write('VP8L', 12); vp8l[20] = 0x2f; vp8l.writeUInt32LE((15) | (7 << 14), 21);
  expect(previewableMedia(vp8l, 'image/webp')).toBe(true);
  const vp8x = Buffer.alloc(30); vp8x.write('RIFF', 0); vp8x.write('WEBP', 8); vp8x.write('VP8X', 12); vp8x.writeUIntLE(9999, 24, 3); vp8x.writeUIntLE(9999, 27, 3);
  expect(previewableMedia(vp8x, 'image/webp')).toBe(false);
  const webm = Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d', 'hex');
  expect(previewableMedia(webm, 'video/webm')).toBe(true);
  expect(previewableMedia(Buffer.from('1a45dfa39f428288766964656f6d6b76', 'hex'), 'video/webm')).toBe(false);
  expect(previewableMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).toBe(false);
});

test('result projection survives a real database restart', async () => {
  const record = fixture.records[0]; if (!record) throw new Error();
  const original = await (await fetch(url + record.resultUrl)).json();
  await app.close(); await pool.end(); await database.stop();
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  expect(await (await fetch(url + record.resultUrl)).json()).toEqual(original);
});
