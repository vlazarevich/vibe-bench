import Fastify from 'fastify';
import { registerRuntime } from '../apps/server/src/features/runtimes.ts';
import { enrollRuntime, runtimeAuthorization } from './runtime-auth.ts';
import { RuntimeConfiguration } from '../packages/contracts/src/access.ts';
import { runtimeRoot } from '../apps/runner/src/configuration.ts';
import { durableWrite } from '../apps/runner/src/spool.ts';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { promisify } from 'node:util';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { createWorkerApp } from '../apps/server/src/worker-app.ts';
import { discoverRuntime, onboard, onboardingUrl } from '../apps/runner/src/onboarding.ts';
import { RuntimeId, RegisteredRuntimes, RuntimeRegistration } from '../packages/contracts/src/runtime.ts';
import { acquireLocalLock } from '../scripts/local-lock.ts';

let root: string;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: Awaited<ReturnType<typeof connectDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let worker: ReturnType<typeof createWorkerApp>;
let url: string;
let workerUrl: string;
let fixturePath: string;
const originalPath = process.env.PATH;
let runtimeId = RuntimeId.parse(randomUUID());
let configuration: RuntimeConfiguration;
const secret = 'NEVER-STORE-CREDENTIAL';
beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true }); root = await mkdtemp(resolve('.artifacts/onboarding-'));
  fixturePath = join(root, 'bin'); await mkdir(fixturePath);
  for (const name of ['codex', 'claude', 'opencode', 'git']) {
    const body = name === 'codex' ? `if (process.argv.includes('status')) process.stderr.write('Logged in using ChatGPT\\n${secret}'); else process.stdout.write('codex 1.2.3 ${secret}');`
      : name === 'claude' ? `if (process.argv.includes('status')) { process.stdout.write(JSON.stringify({loggedIn:true,token:'${secret}'})); process.stderr.write('warning'); } else process.stdout.write('2.3.4');`
      : name === 'opencode' ? `if (process.argv.includes('list')) process.stdout.write('│ OpenAI api\\n1 credential'); else process.stdout.write('3.4.5');`
      : `process.stdout.write('git version 2.4.6 ${secret}');`;
    await writeFile(join(fixturePath, name), `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  }
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool, token: 'secret' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  worker = createWorkerApp({ pool }); workerUrl = await worker.listen({ host: '127.0.0.1', port: 0 });
  configuration = await enrollRuntime(url); runtimeId = configuration.runtimeId;
});
afterAll(async () => { process.env.PATH = originalPath; await worker?.close(); await app?.close(); await pool?.end(); await database?.stop(); });
async function discover(observation = 1) {
  process.env.PATH = fixturePath;
  try { return await discoverRuntime({ runtimeId, observation, slots: 2, timeoutMs: 300 }); }
  finally { process.env.PATH = originalPath; }
}
async function post(registration: unknown, headers = {}, endpoint = workerUrl) {
  return fetch(endpoint + '/api/worker/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: runtimeAuthorization(configuration), ...headers }, body: JSON.stringify(registration) });
}

test('fixture subprocess discovery reports installation and auth independently without secrets or model allowlists', async () => {
  const registration = await discover();
  expect(registration.harnesses).toEqual({ codex: { kind: 'ready' }, claude: { kind: 'ready' }, opencodeGo: { kind: 'not-ready' } });
  expect(registration.tools.find((tool) => tool.name === 'codex')?.availability).toEqual({ kind: 'available', version: '1.2.3' });
  expect(registration.tools.find((tool) => tool.name === 'dotnet')?.availability).toEqual({ kind: 'unavailable', reason: 'missing' });
  expect(JSON.stringify(registration)).not.toContain(secret);
  expect(registration.modelPolicy).toBe('provider-discovered-at-execution');
  expect(() => RuntimeRegistration.parse({ ...registration, capacity: { slots: 0 } })).toThrow();
  expect(() => RuntimeRegistration.parse({ ...registration, tools: registration.tools.map((tool) => ({ ...tool, availability: { kind: 'available', version: secret } })) })).toThrow();
});

test('malformed, unavailable, nonzero, bounded output and timed-out probes remain honest', async () => {
  await writeFile(join(fixturePath, 'claude'), `#!${process.execPath}\nprocess.stdout.write('malformed ${secret}');\n`, { mode: 0o700 });
  await writeFile(join(fixturePath, 'opencode'), `#!${process.execPath}\nprocess.stdout.write('│ OpenCode Go api\\n1 credential');\n`, { mode: 0o700 });
  await writeFile(join(fixturePath, 'node'), `#!${process.execPath}\nsetInterval(()=>{}, 1000);\n`, { mode: 0o700 });
  await writeFile(join(fixturePath, 'make'), `#!${process.execPath}\nprocess.stdout.write('x'.repeat(100000));\n`, { mode: 0o700 });
  await writeFile(join(fixturePath, 'gcc'), `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o700 });
  const registration = await discover();
  expect(registration.harnesses.claude).toEqual({ kind: 'unknown', reason: 'unrecognized' });
  expect(registration.harnesses.opencodeGo).toEqual({ kind: 'ready' });
  expect(registration.tools.find((tool) => tool.name === 'node')?.availability).toEqual({ kind: 'unavailable', reason: 'timeout' });
  expect(registration.tools.find((tool) => tool.name === 'make')?.availability).toEqual({ kind: 'unavailable', reason: 'output-limit' });
  expect(registration.tools.find((tool) => tool.name === 'gcc')?.availability).toEqual({ kind: 'unavailable', reason: 'failed' });
  expect(JSON.stringify(registration)).not.toContain(secret);
});

test('explicit unauthenticated statuses differ from failed status probes', async () => {
  await writeFile(join(fixturePath, 'codex'), `#!${process.execPath}\nprocess.stderr.write('Not logged in'); process.exit(1);\n`, { mode: 0o700 });
  await writeFile(join(fixturePath, 'claude'), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({loggedIn:false})); process.exit(1);\n`, { mode: 0o700 });
  const unauthenticated = await discover();
  expect(unauthenticated.harnesses.codex).toEqual({ kind: 'not-ready' });
  expect(unauthenticated.harnesses.claude).toEqual({ kind: 'not-ready' });
  await writeFile(join(fixturePath, 'codex'), `#!${process.execPath}\nprocess.exit(2);\n`, { mode: 0o700 });
  await writeFile(join(fixturePath, 'claude'), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({loggedIn:true})); process.exit(2);\n`, { mode: 0o700 });
  const failed = await discover();
  expect(failed.harnesses.codex).toEqual({ kind: 'unknown', reason: 'failed' });
  expect(failed.harnesses.claude).toEqual({ kind: 'unknown', reason: 'failed' });
});

test('worker HTTP validates protocol, shape, JSON, content type and size before persistence', async () => {
  configuration = await enrollRuntime(url); runtimeId = configuration.runtimeId;
  const registration = await discover();
  const count = Number((await pool.query('SELECT count(*) FROM runtime_observations')).rows[0].count);
  expect((await post({ ...registration, protocol: 2 })).status).toBe(400);
  expect((await post({ ...registration, secret })).status).toBe(400);
  for (const [body, contentType, status] of [['{', 'application/json', 400], ['{}', 'application/octet-stream', 415], ['x'.repeat(32_001), 'application/json', 413]] satisfies [string, string, number][]) {
    const response = await fetch(workerUrl + '/api/worker/registrations', { method: 'POST', headers: { 'Content-Type': contentType, authorization: runtimeAuthorization(configuration) }, body });
    expect(response.status).toBe(status);
  }
  expect(Number((await pool.query('SELECT count(*) FROM runtime_observations')).rows[0].count)).toBe(count);
  for (const path of ['/api/runner/reports', '/api/evaluations', '/index.html']) {
    expect((await fetch(workerUrl + path)).status).toBe(404);
    expect((await fetch(workerUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
  }
});

test('real HTTP persistence serializes duplicates, rejects conflicts, preserves receipts and latest sequence across restart', async () => {
  const first = await discover();
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(first)));
  expect(responses.every((response) => response.status === 200)).toBe(true);
  const receipts = await Promise.all(responses.map((response) => response.json()));
  expect(receipts.every((receipt) => JSON.stringify(receipt) === JSON.stringify(receipts[0]))).toBe(true);
  expect((await post({ ...first, capacity: { slots: 3 } })).status).toBe(409);
  const newer = { ...first, observation: 3, observedAt: '2020-01-01T00:00:00.000Z' };
  expect((await post(newer)).status).toBe(200);
  expect((await post({ ...first, observation: 2 })).status).toBe(200);
  expect(await (await post(first)).json()).toEqual(receipts[0]);
  await expect(pool.query('UPDATE runtime_observations SET observation = 42')).rejects.toThrow('Immutable');
  await expect(pool.query('DELETE FROM runtime_observations')).rejects.toThrow('Immutable');
  const latest = RegisteredRuntimes.parse(await (await fetch(url + '/api/runtimes')).json());
  expect(latest[0]?.registration).toEqual(newer);
  await worker.close(); await app.close(); await pool.end(); await database.stop();
  database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
  app = await createApp({ pool, token: 'secret' }); url = await app.listen({ host: '127.0.0.1', port: 0 });
  worker = createWorkerApp({ pool }); workerUrl = await worker.listen({ host: '127.0.0.1', port: 0 });
  expect(await (await fetch(url + '/api/runtimes')).json()).toEqual(latest);
  expect(await (await post(first)).json()).toEqual(receipts[0]);
});

function hostPost(endpoint: string, registration: RuntimeRegistration) {
  return new Promise<number | undefined>((resolve, reject) => {
    const req = request(endpoint + '/api/worker/registrations', { method: 'POST', headers: { Host: 'public.example:443', 'Content-Type': 'application/json', authorization: runtimeAuthorization(configuration) } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.end(JSON.stringify(registration));
  });
}

test('worker listener admits outbound workers and rejects browser authority, while local Host policies remain', async () => {
  configuration = await enrollRuntime(url); runtimeId = configuration.runtimeId;
  const registration = await discover();
  expect(await hostPost(workerUrl, registration)).toBe(200);
  expect((await post(registration, { Origin: 'https://public.example' })).status).toBe(403);
  expect((await post(registration, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(403);
  expect((await fetch(workerUrl + '/api/runtimes')).status).toBe(404);
  expect((await fetch(workerUrl + '/api/suites')).status).toBe(404);
  expect((await post(registration, {}, url)).status).toBe(200);
  expect(await hostPost(url, registration)).toBe(403);
  expect((await fetch(url + '/api/suites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
});

test('real CLI is outbound-only with stable identity, durable retry and exclusive state ownership', async () => {
  const stateRoot = join(root, 'cli');
  const cliConfiguration = {...await enrollRuntime(url),apiUrl:workerUrl};
  await durableWrite(join(stateRoot,'config.json'),cliConfiguration);
  const observationRoot = runtimeRoot(stateRoot,cliConfiguration);
  const cli = () => promisify(execFile)(process.execPath, ['--import', 'tsx', 'apps/runner/src/onboard-main.ts'], { cwd: resolve('.'), env: { ...process.env, PATH: fixturePath, VIBE_RUNTIME_STATE: stateRoot, VIBE_RUNTIME_SLOTS: '2' } });
  await cli(); const identity = JSON.parse(await readFile(join(observationRoot, 'identity.json'), 'utf8'));
  expect(await readdir(observationRoot)).toEqual(expect.arrayContaining(['identity.json', 'receipt.json']));
  expect(await readdir(observationRoot)).not.toContain('instance.json');
  await cli(); expect(JSON.parse(await readFile(join(observationRoot, 'identity.json'), 'utf8'))).toEqual({ ...identity, observation: 2 });
  const release = await acquireLocalLock(observationRoot);
  try { await expect(onboard({ stateRoot, slots: 2 })).rejects.toThrow('already running'); } finally { await release(); }
  await durableWrite(join(stateRoot,'config.json'),{...cliConfiguration,apiUrl:'http://127.0.0.1:1'});
  await expect(onboard({ stateRoot, slots: 2 })).rejects.toThrow();
  const pending = JSON.parse(await readFile(join(observationRoot, 'pending.json'), 'utf8'));
  await durableWrite(join(stateRoot,'config.json'),cliConfiguration);
  await cli();
  expect(JSON.parse(await readFile(join(observationRoot, 'receipt.json'), 'utf8')).observation).toBe(pending.observation);
  expect(await readdir(observationRoot)).not.toContain('pending.json');
  expect((await readFile(join(observationRoot, 'receipt.json'), 'utf8'))).not.toContain(secret);

}, 60_000);

test('a response lost after commit retains the exact observation and retrieves its original receipt', async () => {
  configuration = await enrollRuntime(url); runtimeId = configuration.runtimeId;
  const registration = await discover();
  const stateRoot = join(root, 'lost-response');
  const observationRoot = runtimeRoot(stateRoot,configuration);
  await durableWrite(join(observationRoot, 'identity.json'), { runtimeId: registration.runtimeId, observation: registration.observation });
  await durableWrite(join(observationRoot, 'pending.json'), registration);
  const proxy = Fastify(); let drop = true;
  proxy.post('/api/worker/registrations', async (request, reply) => {
    const receipt = await registerRuntime(pool, RuntimeRegistration.parse(request.body));
    if (drop) { drop = false; reply.hijack(); reply.raw.destroy(); return; }
    return receipt;
  });
  const proxyUrl = await proxy.listen({ host: '127.0.0.1', port: 0 });
  try {
    await durableWrite(join(stateRoot,'config.json'),{...configuration,apiUrl:proxyUrl});
    await expect(onboard({ stateRoot, slots: 2 })).rejects.toThrow();
    expect(JSON.parse(await readFile(join(observationRoot, 'pending.json'), 'utf8'))).toEqual(registration);
    const originalReceipt = await registerRuntime(pool, registration);
    expect(await onboard({ stateRoot, slots: 2 })).toEqual(originalReceipt);
    expect(await readdir(observationRoot)).not.toContain('pending.json');
  } finally { await proxy.close(); }
});

test('remote APIs require HTTPS and plain origin configuration', () => {
  expect(onboardingUrl('https://api.example').href).toBe('https://api.example/api/worker/registrations');
  for (const value of ['http://api.example', 'ftp://127.0.0.1', 'https://user:secret@api.example', 'https://api.example/path', 'https://api.example/?token=secret']) expect(() => onboardingUrl(value)).toThrow();
});
