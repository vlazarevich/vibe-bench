import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { unusedPort } from '../scripts/local-database.ts';
// @ts-expect-error The build script is plain ESM shared with the CLI.
import { buildDashboard } from '../scripts/build-dashboard.mjs';

const version = 'v0.0.0-test';
const archiveName = `vibe-bench-dashboard-${version}-linux-x64.tar.gz`;
let root: string;
let assets: string;

beforeAll(async () => {
  await mkdir('.artifacts', { recursive: true });
  root = await mkdtemp(resolve('.artifacts/dashboard-release-'));
  const web = join(root, 'web');
  await mkdir(web);
  await writeFile(join(web, 'index.html'), '<!doctype html><title>packaged dashboard</title>');
  assets = join(root, 'assets');
  await buildDashboard({ version, output: assets, web });
}, 300_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const sha256 = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

test('the archive is self-contained, pinned to the lockfile, and links only inside itself', async () => {
  const sums = await readFile(join(assets, 'SHA256SUMS'), 'utf8');
  expect(sums).toBe(`${await sha256(join(assets, archiveName))}  ${archiveName}\n${await sha256(join(assets, 'install-dashboard.sh'))}  install-dashboard.sh\n`);
  const extracted = join(root, 'extracted');
  await mkdir(extracted);
  execFileSync('tar', ['-xzf', join(assets, archiveName), '-C', extracted]);
  const top = join(extracted, 'vibe-bench-dashboard');
  expect((await readdir(extracted))).toEqual(['vibe-bench-dashboard']);
  expect(await readFile(join(top, 'VERSION'), 'utf8')).toBe(`${version}\n`);
  for (const file of ['dist/server/serve.mjs', 'dist/server/migrate.mjs', 'dist/server/database-worker.mjs', 'dist/server/migrations/011-preview-grants.sql', 'dist/web/index.html', 'deploy/systemd/vibe-bench.service', '.env.example', 'node_modules/embedded-postgres/package.json', 'node_modules/@embedded-postgres/linux-x64/native/bin/postgres'])
    await lstat(join(top, file));
  const modules = await readdir(join(top, 'node_modules'));
  for (const dev of ['vitest', 'vite', '@playwright', 'typescript']) expect(modules).not.toContain(dev);
  // The flat layout keeps only pnpm's lockfile copy in .pnpm, with no package store.
  expect(await readdir(join(top, 'node_modules/.pnpm'))).toEqual(['lock.yaml']);
  const links: string[] = [];
  for (const entry of await readdir(top, { recursive: true, withFileTypes: true }))
    if (entry.isSymbolicLink()) {
      const path = join(entry.parentPath, entry.name);
      expect(resolve(dirname(path), await readlink(path)).startsWith(`${top}/`)).toBe(true);
      links.push(path);
    }
  expect(links.length).toBeGreaterThan(0);
});

test('the installer keeps database state and settings outside what upgrades replace, and the installed dashboard serves with a trimmed password', async () => {
  const commands = join(root, 'commands');
  const installed = join(root, 'opt dir', 'vibe-bench');
  await mkdir(commands);
  await writeFile(join(commands, 'curl'), `#!/bin/sh
set -eu
url=
output=
while [ "$#" -gt 0 ]; do
  case "$1" in https://*) url=$1;; -o) shift; output=$1;; esac
  shift
done
case "$url" in */releases/latest) printf 'https://github.com/example/fork/releases/tag/%s' "$TEST_VERSION";;
  https://github.com/example/fork/releases/download/"$TEST_VERSION"/*) cp "$TEST_ASSETS/\${url##*/}" "$output";;
  *) exit 22;;
esac
`, { mode: 0o755 });
  const source = await readFile('scripts/install-dashboard.sh');
  const state = join(root, 'state dir');
  const env = { ...process.env, PATH: `${commands}:${dirname(process.execPath)}:/usr/bin:/bin`, VIBE_REPOSITORY: 'example/fork', VIBE_DASHBOARD_INSTALL_DIR: installed, VIBE_DASHBOARD_STATE_DIR: state, TEST_VERSION: version, TEST_ASSETS: assets };
  const install = (overrides: Record<string, string> = {}) => execFileSync('/bin/sh', [], { input: source, env: { ...env, ...overrides }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  expect(() => install({ VIBE_DASHBOARD_STATE_DIR: join(installed, 'data') })).toThrow(/outside the installation/);
  expect(() => install({ VIBE_DASHBOARD_STATE_DIR: 'relative' })).toThrow(/absolute path/);
  expect(() => install({ VIBE_DASHBOARD_STATE_DIR: join(root, 'quoted"state') })).toThrow(/must not contain quotes/);
  // A symlinked spelling of a path inside the installation is still inside it.
  await mkdir(dirname(installed), { recursive: true });
  await symlink(dirname(installed), join(root, 'alias'));
  expect(() => install({ VIBE_DASHBOARD_STATE_DIR: join(root, 'alias', 'vibe-bench', 'data') })).toThrow(/outside the installation/);
  expect(() => install({ VIBE_DASHBOARD_STATE_DIR: join(root, 'alias') + '/missing/../vibe-bench/data' })).toThrow(/outside the installation/);
  expect(install()).toContain(`Installed dashboard ${version}`);
  // A first install points embedded state outside the installation, with a fixed port.
  const created = await readFile(join(installed, '.env'), 'utf8');
  expect(created).toContain(`VIBE_LOCAL_ROOT="${state}"`);
  expect(created).toContain('VIBE_PORT=8080');
  expect((await lstat(join(installed, '.env'))).mode & 0o777).toBe(0o600);
  await writeFile(join(installed, '.env'), `${created}VIBE_APP_PASSWORD=" kept secret "\n`);
  const before = await sha256(join(installed, 'dist/server/serve.mjs'));
  const good = await readFile(join(assets, archiveName));
  await writeFile(join(assets, archiveName), 'corrupted archive');
  expect(() => install()).toThrow(/checksum verification failed/);
  await writeFile(join(assets, archiveName), good);
  expect(() => install({ VIBE_DASHBOARD_VERSION: '../../escape' })).toThrow(/release tag/);
  expect(() => install({ VIBE_REPOSITORY: 'not a repository' })).toThrow(/owner\/name/);
  await mkdir(join(root, 'occupied'));
  await writeFile(join(root, 'occupied', 'notes.txt'), 'unrelated');
  expect(() => install({ VIBE_DASHBOARD_INSTALL_DIR: join(root, 'occupied') })).toThrow(/not a Vibe bench dashboard installation/);
  // A built source checkout has the server bundle but no VERSION marker, or has .git; it is never replaced.
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, 'dist/server'), { recursive: true });
  await writeFile(join(checkout, 'dist/server/serve.mjs'), '');
  expect(() => install({ VIBE_DASHBOARD_INSTALL_DIR: checkout })).toThrow(/not a Vibe bench dashboard installation/);
  await writeFile(join(checkout, 'VERSION'), `${version}\n`);
  await mkdir(join(checkout, '.git'));
  expect(() => install({ VIBE_DASHBOARD_INSTALL_DIR: checkout })).toThrow(/not a Vibe bench dashboard installation/);
  expect(await readdir(checkout)).toEqual(['.git', 'VERSION', 'dist']);
  await writeFile(join(commands, 'node'), '#!/bin/sh\nprintf "22\\n"\n', { mode: 0o755 });
  expect(() => install()).toThrow(/Node 24 is required/);
  await rm(join(commands, 'node'));
  expect(await sha256(join(installed, 'dist/server/serve.mjs'))).toBe(before);

  const port = await unusedPort();
  // No VIBE_LOCAL_ROOT here: the installer's .env decides where the database lives.
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server/serve.mjs'], { cwd: installed, env: { PATH: process.env.PATH ?? '', VIBE_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += String(data); });
  child.stderr.on('data', (data) => { output += String(data); });
  const origin = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`Dashboard exited: ${output}`);
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`Dashboard did not start: ${output}`);
      await setTimeout(200);
    }
    expect(await (await fetch(origin)).text()).toContain('packaged dashboard');
    expect(await (await fetch(`${origin}/api/access/session`)).json()).toMatchObject({ passwordRequired: true });
    const login = (password: string) => fetch(`${origin}/api/access/login`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    expect((await login(' kept secret ')).status).toBe(401);
    expect((await login('kept secret')).status).toBe(200);
  } finally {
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGTERM');
    await exited;
  }
  await lstat(join(state, 'postgres', 'PG_VERSION'));
  await expect(lstat(join(installed, '.local'))).rejects.toThrow();
  // Upgrading keeps the settings and leaves the database untouched.
  expect(install({ VIBE_DASHBOARD_VERSION: version })).toContain('Restart the running dashboard');
  expect(await readFile(join(installed, '.env'), 'utf8')).toContain('kept secret');
  await lstat(join(state, 'postgres', 'PG_VERSION'));
  expect(await readdir(dirname(installed))).toEqual(['vibe-bench']);
  // An upgrade interrupted between its two moves is completed from the intact previous installation.
  await rename(installed, `${installed}.previous`);
  expect(install()).toContain('Restart the running dashboard');
  expect(await readFile(join(installed, '.env'), 'utf8')).toContain('kept secret');
  expect(await readdir(dirname(installed))).toEqual(['vibe-bench']);
  // PostgreSQL data anywhere inside an installation, from any VIBE_LOCAL_ROOT, blocks the upgrade instead of being deleted.
  for (const inside of ['.local/postgres', 'data/db/postgres']) {
    await mkdir(join(installed, inside), { recursive: true });
    await writeFile(join(installed, inside, 'PG_VERSION'), '18\n');
    expect(() => install()).toThrow(/Database state was found inside the installation/);
    await lstat(join(installed, inside, 'PG_VERSION'));
    await rm(join(installed, inside.split('/')[0] ?? ''), { recursive: true });
  }
}, 240_000);
