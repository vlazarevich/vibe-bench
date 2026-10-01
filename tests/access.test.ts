import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { createWorkerApp } from '../apps/server/src/worker-app.ts';
import { EnrollmentCommand, EnrollmentReceipt } from '../packages/contracts/src/access.ts';
import { ToolName } from '../packages/contracts/src/runtime.ts';
import { enrollRuntime, runtimeAuthorization } from './runtime-auth.ts';
import { seedArtifactRun } from './artifact-fixtures.ts';

let database: Awaited<ReturnType<typeof startDatabase>>, pool: Awaited<ReturnType<typeof connectDatabase>>, app: Awaited<ReturnType<typeof createApp>>, worker: ReturnType<typeof createWorkerApp>, url: string, workerUrl: string;
const post = (path: string, body: unknown, cookie = '', endpoint = url, headers = {}) => fetch(endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(path.startsWith('/api/worker/') ? {} : { origin: endpoint }), cookie, ...headers }, body: JSON.stringify(body) });
async function login(password = 'correct horse') { const response = await post('/api/access/login', { password }); expect(response.status).toBe(200); return response.headers.get('set-cookie')?.split(';')[0] ?? ''; }
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); const root = await mkdtemp(resolve('.artifacts/access-'));
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool, token: 'legacy-secret', password: 'correct horse' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  worker = createWorkerApp({ pool }); workerUrl = await worker.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => { await worker?.close(); await app?.close(); await pool?.end(); await database?.stop(); });

test('dashboard gate covers all management, blind artifacts, preview and worker listener paths', async () => {
  for (const path of ['/api/runs', '/api/suites', '/api/configured-runs', '/api/runtimes', '/api/runtime-access', '/api/blind-grading/runs', `/api/configured-runs/${randomUUID()}/artifacts/${randomUUID()}`, `/api/blind-grading/${randomUUID()}/assets/${randomUUID()}`, '/api/previews/anything']) expect((await fetch(url + path)).status, path).toBe(401);
  for (const path of ['/api/runtime-enrollments', '/api/suites', '/api/configured-runs', '/api/blind-grading']) expect((await post(path, {})).status).toBe(401);
  expect((await post('/api/access/login', { password: 'bad' })).status).toBe(401);
  expect((await post('/api/access/login', { password: 'correct horse' }, '', url, { origin: 'https://other.example' })).status).toBe(403);
  const cookie = await login();
  expect((await fetch(url + '/api/runs', { headers: { cookie } })).status).toBe(200);
  expect((await fetch(workerUrl + '/api/runs', { headers: { cookie } })).status).toBe(404);
  await post('/api/access/logout', {}, cookie);
  expect((await fetch(url + '/api/runs', { headers: { cookie } })).status).toBe(401);
});

test('session expiry, password rotation and passwordless transitions invalidate durable authority', async () => {
  const cookie = await login();
  await pool.query("UPDATE dashboard_sessions SET expires_at=now()-interval '1 second'");
  expect((await fetch(url + '/api/runs', { headers: { cookie } })).status).toBe(401);
  const fresh = await login();
  await app.close(); app = await createApp({ pool, token: 'legacy-secret', password: 'rotated' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  expect((await fetch(url + '/api/runs', { headers: { cookie: fresh } })).status).toBe(401);
  const rotated = await login('rotated');
  await app.close(); app = await createApp({ pool, token: 'legacy-secret', password: '' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  expect((await fetch(url + '/api/runs')).status).toBe(200);
  await app.close(); app = await createApp({ pool, token: 'legacy-secret', password: 'rotated' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  expect((await fetch(url + '/api/runs', { headers: { cookie: rotated } })).status).toBe(401);
});

test('single-use enrollment serializes competitors, supports exact lost acknowledgement replay, and rejects expiry', async () => {
  const cookie = await login('rotated');
  const created = await (await post('/api/runtime-enrollments', { target: { kind: 'new' } }, cookie)).json();
  const command = EnrollmentCommand.parse(JSON.parse(Buffer.from(created.command.split(' ')[2], 'base64url').toString()));
  const exchange = { requestId: randomUUID(), key: command.key, credentialId: randomUUID(), secret: randomBytes(32).toString('hex') };
  const exchanges = Array.from({ length: 8 }, (_, index) => index === 0 ? exchange : { ...exchange, credentialId: randomUUID() });
  const responses = await Promise.all(exchanges.map((input) => post('/api/worker/enrollments', input, '', workerUrl)));
  expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
  const winner = responses.find((response) => response.status === 200); if (!winner) throw new Error();
  const receipt = EnrollmentReceipt.parse(await winner.json());
  expect((await pool.query('SELECT count(*)::int AS n FROM runtime_credentials WHERE runtime_id=$1', [receipt.runtimeId])).rows[0].n).toBe(1);
  const accepted = exchanges.find((input) => input.credentialId === receipt.credentialId);
  const retries = await Promise.all(Array.from({ length: 4 }, () => post('/api/worker/enrollments', accepted, '', workerUrl)));
  for (const retry of retries) expect(await retry.json()).toEqual(receipt);
  const expiring = await (await post('/api/runtime-enrollments', { target: { kind: 'new' } }, cookie)).json();
  const expired = EnrollmentCommand.parse(JSON.parse(Buffer.from(expiring.command.split(' ')[2], 'base64url').toString()));
  await pool.query('UPDATE runtime_enrollments SET expires_at=now() WHERE key_hash=$1', [createHash('sha256').update(expired.key).digest('hex')]);
  expect((await post('/api/worker/enrollments', { ...exchange, key: expired.key }, '', workerUrl)).status).toBe(401);
});

test('runtime credentials isolate identities, cannot grant dashboard access, and revoke on both listeners', async () => {
  const cookie = await login('rotated');
  const a = await enrollRuntime(url, undefined, cookie), b = await enrollRuntime(url, undefined, cookie);
  const authorization = runtimeAuthorization(a);
  expect((await post('/api/worker/registrations', { protocol: 1, runtimeId: a.runtimeId, observation: 1, observedAt: new Date().toISOString(), capacity: { slots: 1 }, machine: { platform: 'linux', architecture: 'x64', logicalCpus: 1, memoryBytes: 1024 }, tools: ToolName.options.map((name) => ({ name, availability: { kind: 'unavailable', reason: 'missing' } })), harnesses: { codex: { kind: 'not-ready' }, claude: { kind: 'not-ready' }, opencodeGo: { kind: 'not-ready' } }, modelPolicy: 'provider-discovered-at-execution' }, '', workerUrl, { authorization })).status).toBe(200);
  for (const endpoint of [url, workerUrl]) {
    expect((await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId: b.runtimeId }, '', endpoint, { authorization })).status).toBe(401);
    expect((await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId: a.runtimeId }, '', endpoint, { authorization })).status).toBe(200);
    expect((await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId: a.runtimeId }, '', endpoint)).status).toBe(401);
  }
  expect((await fetch(url + '/api/runs', { headers: { authorization } })).status).toBe(401);
  await post(`/api/runtimes/${a.runtimeId}/revoke`, {}, cookie);
  for (const endpoint of [url, workerUrl]) expect((await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId: a.runtimeId }, '', endpoint, { authorization })).status).toBe(401);
  const replacement = await enrollRuntime(url, a.runtimeId, cookie);
  expect(replacement.runtimeId).toBe(a.runtimeId); expect(replacement.installationId).toBe(a.installationId);
  expect((await post('/api/worker/claims', { protocol: 1, requestId: randomUUID(), runtimeId: a.runtimeId }, '', workerUrl, { authorization: runtimeAuthorization(replacement) })).status).toBe(200);
});

test('protected real artifact fixture requires dashboard session and keeps runtime secrets out of management responses', async () => {
  const cookie = await login('rotated');
  const fixture = await seedArtifactRun(url, cookie);
  const resultPath = `/api/configured-runs/${fixture.run.runId}`;
  expect((await fetch(url + resultPath)).status).toBe(401);
  expect((await fetch(url + resultPath, { headers: { cookie } })).status).toBe(200);
  const data = await (await fetch(url + '/api/runtime-access', { headers: { cookie } })).text();
  expect(data).not.toContain('secret'); expect(data).not.toContain('credentialId');
}, 30_000);

test('canonical HTTPS origin controls host, CSRF and secure cookies and bounded guessing throttle', async () => {
  const secure = await createApp({ pool, token: 'legacy-secret', password: 'rotated', publicUrl: 'https://bench.example', trustedProxy: ['127.0.0.1'] });
  try {
    expect((await secure.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    const response = await secure.inject({ method: 'POST', url: '/api/access/login', headers: { host: 'bench.example', origin: 'https://bench.example', 'x-forwarded-for': '192.0.2.1' }, payload: { password: 'rotated' } });
    expect(response.statusCode).toBe(200); expect(response.headers['set-cookie']).toContain('Secure'); expect(response.headers['set-cookie']).toContain('HttpOnly'); expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    for (let index = 0; index < 10; index++) await secure.inject({ method: 'POST', url: '/api/access/login', headers: { host: 'bench.example', origin: 'https://bench.example', 'x-forwarded-for': '192.0.2.2' }, payload: { password: 'bad' } });
    expect((await secure.inject({ method: 'POST', url: '/api/access/login', headers: { host: 'bench.example', origin: 'https://bench.example', 'x-forwarded-for': '192.0.2.2' }, payload: { password: 'rotated' } })).statusCode).toBe(429);
    expect((await pool.query('SELECT count(*)::int AS n FROM login_attempts')).rows[0].n).toBeLessThanOrEqual(4);
  } finally { await secure.close(); }
});
