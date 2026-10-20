import { afterAll, beforeAll, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { vercelConfig } from '../scripts/vercel-config.ts';
import { startDatabase } from '../scripts/local-database.ts';
import { definition } from './suite-fixtures.ts';
import { SuiteList, SuiteView } from '../packages/contracts/src/suites.ts';
// @ts-expect-error Plain ESM build script shared with the CLI.
import { buildVercel } from '../scripts/build-vercel.mjs';

let root: string;
let functionRoot: string;
let database: Awaited<ReturnType<typeof startDatabase>>;
const children: ChildProcess[] = [];
const password = 'hosted secret';
const publicUrl = 'https://bench.example';
const big = Buffer.alloc(6 * 1024 * 1024, 23);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  // Outside the checkout: no repository node_modules can hide an incomplete function bundle.
  root = await mkdtemp(join(tmpdir(), 'vibe-vercel-'));
  const web = join(root, 'web');
  await mkdir(join(web, 'assets'), { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><title>hosted dashboard</title>');
  await writeFile(join(web, 'assets/large.bin'), big);
  functionRoot = await buildVercel({ output: join(root, 'output'), web });
  await writeFile(join(root, 'serve.mjs'), `
import { createServer } from 'node:http';
import handler from ${JSON.stringify(pathToFileURL(join(functionRoot, 'index.mjs')).href)};
const server = createServer((request, response) => { void handler(request, response); });
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('message', (env) => { Object.assign(process.env, env); process.send('updated'); });
`);
  database = await startDatabase(join(root, 'postgres'));
}, 120_000);

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  await database?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});

async function launch(settings: Record<string, string> = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VIBE_|VERCEL|DATABASE_URL$|POSTGRES_URL$)/.test(key)));
  const child = spawn(process.execPath, [join(root, 'serve.mjs')], { cwd: root,
    env: { ...inherited, POSTGRES_URL: database.url, VIBE_APP_PASSWORD: ` ${password} `,
      VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'bench.example', ...settings },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let output = '';
  child.stderr!.on('data', (data) => { output += String(data); });
  const [{ port }] = await once(child, 'message') as [{ port: number }];
  const request = (path: string, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${port}${path}`, {
      method: init.method ?? 'GET', headers: { host: 'bench.example', ...Object.fromEntries(new Headers(init.headers)) },
    }, async (incoming) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers))
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode!, headers }));
      } catch (error) { reject(error); }
    });
    request.on('error', reject);
    request.end(typeof init.body === 'string' ? init.body : undefined);
  });
  const post = (path: string, body: unknown, cookie = '') => request(path, { method: 'POST',
    headers: { origin: publicUrl, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  return { child, request, post, output: () => output };
}

const settings = { POSTGRES_URL: 'postgresql://u:p@db/bench?sslmode=require', VIBE_APP_PASSWORD: ' secret ', VERCEL_URL: 'preview.example' };
test('hosted configuration requires external persistence, a password, and a pinned HTTPS origin', () => {
  expect(vercelConfig(settings)).toEqual({ databaseUrl: settings.POSTGRES_URL, password: 'secret', publicUrl: 'https://preview.example' });
  expect(vercelConfig({ ...settings, VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'production.example' }).publicUrl).toBe('https://production.example');
  expect(vercelConfig({ ...settings, VIBE_PUBLIC_URL: 'https://custom.example' }).publicUrl).toBe('https://custom.example');
  expect(vercelConfig({ ...settings, DATABASE_URL: 'postgres://other/db' }).databaseUrl).toBe('postgres://other/db');
  for (const override of [{ POSTGRES_URL: '' }, { VIBE_APP_PASSWORD: ' ' }, { VERCEL_URL: '' },
    { VIBE_PUBLIC_URL: 'http://bench.example' }, { VIBE_WORKER_PORT: '8001' }])
    expect(() => vercelConfig({ ...settings, ...override })).toThrow();
});

test('the isolated function serves concurrent cold requests, preserves authority across instances, and streams large files', async () => {
  const first = await launch();
  const second = await launch();
  const cold = await Promise.all([first.request('/api/health'), first.request('/api/access/session'), second.request('/api/health')]);
  expect(cold.map((response) => response.status)).toEqual([200, 200, 200]);
  expect(await cold[1]!.json()).toMatchObject({ passwordRequired: true });
  expect(await (await first.request('/')).text()).toContain('hosted dashboard');
  expect(await (await first.request('/login')).text()).toContain('hosted dashboard');
  expect((await first.request('/api/suites')).status).toBe(401);
  expect((await first.post('/api/access/login', { password: 'wrong' })).status).toBe(401);
  const login = await first.post('/api/access/login', { password });
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toContain('Secure');
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const createdResponse = await second.post('/api/suites', { definition: definition() }, cookie);
  expect(createdResponse.status).toBe(200);
  const created = SuiteView.parse(await createdResponse.json());
  const third = await launch();
  const list = await third.request('/api/suites', { headers: { cookie } });
  expect(SuiteList.parse(await list.json()).some((suite) => suite.suiteId === created.content.suiteId)).toBe(true);
  expect((await first.request('/api/suites', { headers: { host: 'hostile.example', cookie } })).status).toBe(403);
  expect((await first.request('/api/health', { headers: { host: 'probe' } })).status).toBe(200);
  expect((await first.request('/api/access/logout', { method: 'POST', headers: { origin: 'https://hostile.example', cookie } })).status).toBe(403);
  const media = await first.request('/assets/large.bin');
  expect(media.status).toBe(200);
  expect(media.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(cold[0]!.headers.get('cache-control')).toContain('no-store');
  expect(hash(new Uint8Array(await media.arrayBuffer()))).toBe(hash(big));
  expect((await first.request('/api/worker/claims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  expect((await first.request('/migrations/011-preview-grants.sql')).status).toBe(401);
  const admin = new pg.Client({ connectionString: database.url });
  await admin.connect();
  try { expect((await admin.query('SELECT count(*)::int AS count FROM schema_migrations')).rows).toEqual([{ count: 11 }]); }
  finally { await admin.end(); }
  expect(await readdir(functionRoot)).toEqual(expect.arrayContaining(['index.mjs', 'migrations', 'web', '.vc-config.json']));
  expect(await readdir(root)).not.toContain('.local');
  const runtime = JSON.parse(await readFile(join(functionRoot, '.vc-config.json'), 'utf8'));
  expect(runtime).toMatchObject({ runtime: 'nodejs24.x', supportsResponseStreaming: true });
}, 120_000);

test('failed cold initialization returns a sanitized error and retries successfully', async () => {
  const broken = await launch({ POSTGRES_URL: 'postgres://sensitive:secret@127.0.0.1:1/unavailable' });
  const failed = await broken.request('/api/health');
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: 'Dashboard unavailable' });
  expect(broken.output()).not.toContain('sensitive');
  expect(broken.output()).not.toContain('secret');
  const updated = once(broken.child, 'message');
  broken.child.send({ POSTGRES_URL: database.url });
  await updated;
  expect((await broken.request('/api/health')).status).toBe(200);
});
