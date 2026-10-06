import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, stat, readdir, rm, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const execute = promisify(execFile);
const binary = resolve(process.env.VIBE_RUNTIME_BINARY ?? 'dist/runtime/vibe-runner');
const version = (await execute(binary, ['--version'])).stdout.trim();
assert.match(version, /^v\d+\.\d+\.\d+/);

test('standalone CLI exposes command help and actionable errors with consistent exit codes', async () => {
  const help = (await execute(binary, ['--help'])).stdout;
  assert.match(help, /vibe-runner/);
  for (const command of ['pair', 'run', 'run-once']) assert.match(help, new RegExp(command));
  assert.match((await execute(binary, ['pair', '--help'])).stdout, /status/);
  await assert.rejects(execute(binary, ['unknown-command']), (error) => error.code === 2 && /unknown command/i.test(error.stderr));
  const state = await mkdtemp(join(tmpdir(), 'vibe-binary-errors-'));
  try {
    await assert.rejects(execute(binary, ['--state-dir', state, 'pair', 'invalid-token']), (error) => error.code === 1 && error.stderr.length > 0 && !error.stderr.includes('Runtime failed'));
  } finally { await rm(state, { recursive: true, force: true }); }
});

test('standalone CLI pairs, persists a private credential, checks cached status, probes, and revokes without Node or a checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibe-binary-auth-'));
  const standalone = join(directory, 'vibe-runner');
  await copyFile(binary, standalone);
  const installationId = randomUUID();
  const runtimeId = randomUUID();
  const requests = [];
  let enrollment;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = Buffer.concat(chunks).toString();
    const body = payload ? JSON.parse(payload) : null;
    requests.push({ path: request.url, authorization: request.headers.authorization, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/worker/enrollments') {
      enrollment = body;
      response.end(JSON.stringify({ installationId, runtimeId, credentialId: body.credentialId, requestId: body.requestId }));
    } else if (request.url === '/api/worker/registrations') {
      response.end(JSON.stringify({ runtimeId, observation: body.observation, observedAt: body.observedAt, receivedAt: new Date().toISOString() }));
    } else if (request.url === '/api/worker/status') {
      response.end(JSON.stringify({ runtimeId, observation: 1 }));
    } else if (request.url === '/api/worker/revoke') {
      response.end(JSON.stringify({ ok: true }));
    } else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const state = join(directory, 'state');
    const env = { HOME: directory, PATH: join(directory, 'no-tools') };
    const command = Buffer.from(JSON.stringify({ apiUrl: `http://127.0.0.1:${address.port}`, key: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() })).toString('base64url');
    const configured = await execute(standalone, ['--state-dir', state, 'pair', command], { cwd: directory, env });
    assert.match(configured.stdout, /paired/i);
    const config = JSON.parse(await readFile(join(state, 'config.json'), 'utf8'));
    assert.equal(config.runtimeId, runtimeId);
    assert.equal(config.installationId, installationId);
    assert.equal(config.secret, enrollment.secret);
    assert.equal((await stat(join(state, 'config.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(state)).mode & 0o777, 0o700);
    const registration = requests.find((entry) => entry.path === '/api/worker/registrations').body;
    assert.equal(registration.runtimeId, runtimeId);
    assert.equal(registration.tools.find((tool) => tool.name === 'node').availability.kind, 'unavailable');
    for (const name of ['codex', 'claude', 'opencode']) assert.equal(registration.tools.find((tool) => tool.name === name).availability.kind, 'unavailable');
    assert.equal('capacity' in registration, false);
    const beforeStatus = requests.filter((entry) => entry.path === '/api/worker/registrations').length;
    const status = await execute(standalone, ['--state-dir', state, 'pair', 'status'], { cwd: directory, env });
    assert.equal(JSON.parse(status.stdout).status, 'paired');
    assert.equal(requests.filter((entry) => entry.path === '/api/worker/registrations').length, beforeStatus);
    await execute(standalone, ['--state-dir', state, 'pair', 'probe'], { cwd: directory, env });
    assert.equal(requests.filter((entry) => entry.path === '/api/worker/registrations').length, beforeStatus + 1);
    const revoked = await execute(standalone, ['--state-dir', state, 'pair', 'revoke'], { cwd: directory, env });
    assert.equal(requests.at(-1).path, '/api/worker/revoke');
    await assert.rejects(readFile(join(state, 'config.json'), 'utf8'), { code: 'ENOENT' });
    for (const request of requests.slice(1)) assert.equal(request.authorization, `Bearer ${config.credentialId}.${config.secret}`);
    assert.ok(!configured.stdout.includes(config.secret));
    assert.ok(!status.stdout.includes(config.secret));
    assert.ok(!revoked.stdout.includes(config.secret));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('standalone fixture subprocesses execute all three adapter protocols', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibe-binary-fixture-'));
  try {
    for (const harness of ['codex', 'claude', 'opencode']) {
      const output = join(directory, `${harness}.txt`);
      const child = execFile(binary, ['--internal-configured-fixture', harness, '--output-last-message', output], { cwd: directory, env: { PATH: '/nonexistent' } });
      child.stdin.end('Task kind: text-generation\n');
      const result = await new Promise((resolve, reject) => {
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
      });
      if (harness === 'codex') assert.equal(await readFile(output, 'utf8'), 'Fixture final answer');
      else assert.match(result, /Fixture final answer/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('shell installer pins and verifies releases, preserves the old binary on corruption, and supports stdin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibe-binary-install-'));
  const source = await readFile('scripts/install-runtime.sh');
  const assets = join(directory, 'assets');
  const commands = join(directory, 'commands');
  const installed = join(directory, 'bin with spaces');
  await mkdir(assets); await mkdir(commands);
  const archive = `vibe-runner-${version}-linux-x64.tar.gz`;
  await copyFile(resolve('dist/runtime', archive), join(assets, archive));
  await copyFile(resolve('dist/runtime/SHA256SUMS'), join(assets, 'SHA256SUMS'));
  await writeFile(join(commands, 'curl'), `#!/bin/sh
set -eu
url=
output=
while [ "$#" -gt 0 ]; do
  case "$1" in https://*) url=$1;; -o) shift; output=$1;; esac
  shift
done
case "$url" in */releases/latest) printf 'https://github.com/vlazarevich/vibe-bench/releases/tag/%s' "$TEST_VERSION";;
  */download/"$TEST_VERSION"/*) cp "$TEST_ASSETS/\${url##*/}" "$output";;
  *) exit 22;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${commands}:/usr/bin:/bin`, VIBE_RUNTIME_VERSION: version, VIBE_RUNTIME_INSTALL_DIR: installed, TEST_VERSION: version, TEST_ASSETS: assets };
  const install = (overrides = {}) => execFileSync('/bin/sh', [], { input: source, env: { ...env, ...overrides }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    assert.match(install(), /Installed/);
    assert.equal((await execute(join(installed, 'vibe-runner'), ['--version'])).stdout.trim(), version);
    assert.match(install({ VIBE_RUNTIME_VERSION: '' }), /Installed/);
    const previous = createHash('sha256').update(await readFile(join(installed, 'vibe-runner'))).digest('hex');
    await writeFile(join(assets, archive), 'corrupted archive');
    assert.throws(() => install(), /checksum verification failed/);
    assert.equal(createHash('sha256').update(await readFile(join(installed, 'vibe-runner'))).digest('hex'), previous);
    await writeFile(join(assets, 'SHA256SUMS'), '0'.repeat(64) + '  different.tar.gz\n');
    assert.throws(() => install(), /Missing or duplicate archive checksum/);
    const malformed = join(directory, 'malformed');
    await mkdir(malformed);
    await writeFile(join(malformed, 'unexpected'), 'unexpected member');
    execFileSync('tar', ['-czf', join(assets, archive), '-C', malformed, 'unexpected']);
    await writeFile(join(assets, 'SHA256SUMS'), `${createHash('sha256').update(await readFile(join(assets, archive))).digest('hex')}  ${archive}\n`);
    assert.throws(() => install(), /unexpected files/);
    await writeFile(join(malformed, 'vibe-runner'), `#!/bin/sh\nprintf 'v999.0.0\\n'\n`, { mode: 0o755 });
    execFileSync('tar', ['-czf', join(assets, archive), '-C', malformed, 'vibe-runner']);
    await writeFile(join(assets, 'SHA256SUMS'), `${createHash('sha256').update(await readFile(join(assets, archive))).digest('hex')}  ${archive}\n`);
    assert.throws(() => install(), /version does not match/);
    assert.equal(createHash('sha256').update(await readFile(join(installed, 'vibe-runner'))).digest('hex'), previous);
    assert.deepEqual(await readdir(installed), ['vibe-runner']);
    assert.throws(() => install({ VIBE_RUNTIME_VERSION: '../../unexpected' }), /release tag/);
    await writeFile(join(commands, 'uname'), '#!/bin/sh\nif [ "$1" = -s ]; then printf "Linux\\n"; else printf "aarch64\\n"; fi\n', { mode: 0o755 });
    assert.throws(() => install(), /Only Linux x64 is supported/);
    await writeFile(join(commands, 'uname'), '#!/bin/sh\nprintf "Darwin\\n"\n', { mode: 0o755 });
    assert.throws(() => install(), /Only Linux x64 is supported/);
    await rm(join(commands, 'uname'));
    await writeFile(join(commands, 'getconf'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    assert.throws(() => install(), /glibc/);
    assert.equal(createHash('sha256').update(await readFile(join(installed, 'vibe-runner'))).digest('hex'), previous);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
