import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startDatabase } from '../scripts/local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { createWorkerApp } from '../apps/server/src/worker-app.ts';
import { configureRuntime, runtimeRoot } from '../apps/runner/src/configuration.ts';
import { EnrollmentCommand } from '../packages/contracts/src/access.ts';
import { RunAssignment, AttemptReport } from '../packages/contracts/src/work.ts';
import { ConfiguredRunView } from '../packages/contracts/src/configured-runs.ts';
import { SuiteView } from '../packages/contracts/src/suites.ts';
import { ToolName } from '../packages/contracts/src/runtime.ts';
import { runtimeAuthorization } from './runtime-auth.ts';
import { definition } from './suite-fixtures.ts';

const exec = promisify(execFile);
async function setup() {
  const artifacts = resolve(process.env.VIBE_TEST_ARTIFACTS ?? '.artifacts'); await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(artifacts, 'runtime-recovery-'));
  let database = await startDatabase(join(root, 'postgres')), pool = await connectDatabase(database.url);
  let app = await createApp({ pool, password: 'recovery-password' }), worker = createWorkerApp({ pool });
  let url = await app.listen({ host: '127.0.0.1', port: 0 }), workerUrl = await worker.listen({ host: '127.0.0.1', port: 0 });
  const login = await fetch(url + '/api/access/login', { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'recovery-password' }) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''; expect(cookie).not.toBe('');
  const post = async (path: string, body: unknown) => {
    const response = await fetch(url + path, { method: 'POST', headers: { origin: url, 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    expect(response.status, await response.clone().text()).toBe(200); return response.json();
  };
  return {
    root, get pool() { return pool; }, get workerUrl() { return workerUrl; },
    async enroll(stateRoot: string, apiUrl: string, runtimeId?: string) {
      const created = await post('/api/runtime-enrollments', { target: runtimeId ? { kind: 'replace', runtimeId } : { kind: 'new' } });
      const command = EnrollmentCommand.parse(JSON.parse(Buffer.from(created.command.split(' ')[2], 'base64url').toString()));
      const configuration = await configureRuntime(stateRoot, Buffer.from(JSON.stringify({ ...command, apiUrl })).toString('base64url'));
      const registered = await fetch(workerUrl + '/api/worker/registrations', { method: 'POST', headers: { 'content-type': 'application/json', authorization: runtimeAuthorization(configuration) }, body: JSON.stringify({ protocol: 1, runtimeId: configuration.runtimeId, observation: Date.now(), observedAt: new Date().toISOString(), machine: { platform: 'linux', architecture: 'x64', logicalCpus: 1, memoryBytes: 1024 }, tools: ToolName.options.map((name) => ({ name, availability: { kind: 'unavailable', reason: 'missing' } })), harnesses: { codex: { kind: 'not-ready' }, claude: { kind: 'not-ready' }, opencodeGo: { kind: 'not-ready' } }, modelPolicy: 'provider-discovered-at-execution' }) });
      expect(registered.status).toBe(200); return configuration;
    },
    async createRun(runtimeId: string, source: 'fixture' | 'live' = 'fixture') {
      const suite = SuiteView.parse(await post('/api/suites', { definition: definition() }));
      return ConfiguredRunView.parse(await post('/api/configured-runs', { requestId: randomUUID(), contentId: suite.content.contentId, runtimeId, selection: { kind: 'all' }, source, entrants: Array.from({ length: 3 }, () => ({ id: randomUUID(), harness: 'codex', model: 'recovery-fixture', settings: { timeoutMs: 15000 } })) }));
    },
    revoke: (runtimeId: string) => post(`/api/runtimes/${runtimeId}/revoke`, {}),
    async restart() {
      await worker.close(); await app.close(); await pool.end(); await database.stop();
      database = await startDatabase(join(root, 'postgres')); pool = await connectDatabase(database.url);
      app = await createApp({ pool, password: 'recovery-password' }); worker = createWorkerApp({ pool });
      url = await app.listen({ host: '127.0.0.1', port: 0 }); workerUrl = await worker.listen({ host: '127.0.0.1', port: 0 });
    },
    async close() { await worker.close(); await app.close(); await pool.end(); await database.stop(); },
  };
}
const workScript = "import {readConfiguration} from './apps/runner/src/configuration.ts'; import {runWorkerOnce} from './apps/runner/src/execution.ts'; const stateRoot=process.env.VIBE_RUNTIME_STATE; console.log(JSON.stringify(await runWorkerOnce({configuration:await readConfiguration(stateRoot),stateRoot,executables:{}})));";
const work = (stateRoot: string) => exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', workScript], { env: { ...process.env, VIBE_RUNTIME_STATE: stateRoot }, maxBuffer: 100_000 });

test('connectivity loss and lost committed acknowledgement recover across runtime and server restarts', async () => {
  const system = await setup(); const stateRoot = join(system.root, 'runtime');
  let offline = false, loseTerminalAck = false, claims = 0;
  const delivered: { reportId: string; body: string; status: number }[] = [];
  const proxy = createServer((request, response) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString(); const path = request.url ?? '';
    const report = path === '/api/worker/preparations' || path === '/api/worker/attempts';
    if (report && offline) { request.socket.destroy(); return; }
    const upstream = await fetch(system.workerUrl + path, { method: request.method ?? 'POST', headers: { 'content-type': 'application/json', ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) }, body });
    const result = await upstream.text();
    if (path === '/api/worker/claims') claims++;
    if (report) delivered.push({ reportId: JSON.parse(body).reportId, body, status: upstream.status });
    if (loseTerminalAck && path === '/api/worker/attempts' && AttemptReport.parse(JSON.parse(body)).kind === 'terminal' && upstream.ok) { loseTerminalAck = false; request.socket.destroy(); return; }
    response.statusCode = upstream.status; response.end(result);
    if (path === '/api/worker/claims' && JSON.parse(result).kind === 'assigned') offline = true;
  })().catch(() => { response.destroy(); }); });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done)); const address = proxy.address(); if (!address || typeof address === 'string') throw new Error();
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  try {
    const original = await system.enroll(stateRoot, proxyUrl); const run = await system.createRun(original.runtimeId);
    await expect(work(stateRoot)).rejects.toThrow();
    const journal = join(runtimeRoot(stateRoot, original), 'work', run.runId);
    const assignment = RunAssignment.parse(JSON.parse(await readFile(join(journal, 'assignment.json'), 'utf8')));
    async function records() { return Promise.all(assignment.attempts.map(async (attempt) => {
      const terminal = join(journal, attempt.attemptId, 'terminal.json'); const started = join(journal, attempt.attemptId, 'started.json');
      return { terminal: await readFile(terminal, 'utf8'), terminalTime: (await stat(terminal)).mtimeMs, startTime: (await stat(started)).mtimeMs };
    })); }
    const collected = await records(); expect(collected).toHaveLength(3); expect(collected.map((record) => JSON.parse(record.terminal).outcome.kind)).toEqual(['completed', 'completed', 'completed']);
    expect((await system.pool.query('SELECT count(*)::int AS n FROM attempt_outcomes')).rows[0].n).toBe(0); expect(claims).toBe(1);
    offline = false;
    loseTerminalAck = true;
    await expect(work(stateRoot)).rejects.toThrow();
    expect((await system.pool.query('SELECT count(*)::int AS n FROM attempt_outcomes')).rows[0].n).toBe(1);
    const accepted = await system.pool.query('SELECT report_id, receipt FROM work_reports ORDER BY report_id'); expect(accepted.rows).toHaveLength(3);
    const committedTerminal = delivered.find((entry) => entry.status === 200 && JSON.parse(entry.body).kind === 'terminal'); if (!committedTerminal) throw new Error();
    const savedReceipts = await readdir(join(journal, 'receipts')); expect(savedReceipts).not.toContain(`${committedTerminal.reportId}.json`);
    await system.restart();
    expect(JSON.parse((await work(stateRoot)).stdout)).toEqual({ kind: 'finished', runId: run.runId });
    expect(await records()).toEqual(collected);
    expect((await system.pool.query('SELECT count(*)::int AS n FROM attempt_outcomes')).rows[0].n).toBe(3);
    expect((await system.pool.query('SELECT count(*)::int AS n FROM work_reports')).rows[0].n).toBe(7);
    for (const row of accepted.rows) expect((await system.pool.query('SELECT receipt FROM work_reports WHERE report_id=$1', [row.report_id])).rows[0].receipt).toEqual(row.receipt);
    expect(delivered.filter((entry) => entry.reportId === committedTerminal.reportId && entry.status === 200).map((entry) => entry.body)).toEqual([committedTerminal.body, committedTerminal.body]);
    expect(claims).toBe(1);
  } finally { await new Promise<void>((done) => proxy.close(() => done())); await system.close(); }
}, 30_000);

test('SIGTERM exits the continuous worker after stopping the active child instead of reconnecting', async () => {
  const system = await setup(); const stateRoot = join(system.root, 'runtime'), marker = join(system.root, 'starts.txt'), executable = join(system.root, 'codex');
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const configuration = await system.enroll(stateRoot, system.workerUrl); await system.createRun(configuration.runtimeId, 'live');
    const claim = await fetch(system.workerUrl + '/api/worker/claims', { method: 'POST', headers: { 'content-type': 'application/json', authorization: runtimeAuthorization(configuration) }, body: JSON.stringify({ protocol: 1, requestId: randomUUID(), runtimeId: configuration.runtimeId }) });
    const assignment = RunAssignment.parse(await claim.json());
    const { durableWrite } = await import('../apps/runner/src/spool.ts');
    await durableWrite(join(runtimeRoot(stateRoot, configuration), 'work', 'assignment.json'), assignment);
    await writeFile(executable, `#!${process.execPath}\nconst fs=await import('node:fs'); if(process.argv.includes('--version')) { console.log('fixture 1.0.0'); process.exit(); } if(process.env.VIBE_APP_PASSWORD || process.env.VIBE_RUNTIME_CREDENTIAL) throw new Error('Runtime secret reached harness'); fs.appendFileSync(${JSON.stringify(marker)},'started\\n'); setTimeout(()=>{},15000);\n`, { mode: 0o700 });
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/runner/src/cli-main.ts', '--state-dir', stateRoot, 'run'], { env: { ...process.env, PATH: `${system.root}:${process.env.PATH}`,  VIBE_APP_PASSWORD: 'app-password-canary', VIBE_RUNTIME_CREDENTIAL: 'runtime-credential-canary' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise<number | null>((done) => child?.once('exit', done));
    await expect.poll(async () => { try { return await readFile(marker, 'utf8'); } catch { return ''; } }, { timeout: 5000 }).toBe('started\n');
    child.kill('SIGTERM');
    const exit = await Promise.race([exited, new Promise<'timeout'>((done) => { const timer = setTimeout(() => done('timeout'), 3000); timer.unref(); })]);
    expect(exit).not.toBe('timeout'); expect(exit).not.toBe(0); expect(await readFile(marker, 'utf8')).toBe('started\n');
    expect((await system.pool.query('SELECT count(*)::int AS n FROM attempt_starts')).rows[0].n).toBeLessThanOrEqual(1);
  } finally { child?.kill('SIGKILL'); await system.close(); }
}, 15_000);
