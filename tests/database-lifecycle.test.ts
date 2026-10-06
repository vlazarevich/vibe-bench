import { expect, test } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { z } from 'zod';
import pg from 'pg';
import { startDatabase } from '../scripts/local-database.ts';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);

async function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return process.platform !== 'linux' || !/\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'));
  } catch { return false; }
}

test('stops PostgreSQL when the app is interrupted during database startup', async () => {
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/database-startup-'));
  const directory = join(root, 'postgres');
  const owner = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/local.ts')], { env: { ...process.env, VIBE_LOCAL_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  owner.stderr.on('data', (data) => { diagnostics += String(data); });
  let pids: number[] = [];
  try {
    await expect.poll(async () => {
      if (owner.exitCode !== null) throw new Error(`App exited: ${diagnostics}`);
      try { return Number((await readFile(join(directory, 'postmaster.pid'), 'utf8')).split('\n')[0]) > 0; } catch { return false; }
    }, { timeout: 90_000 }).toBe(true);
    const pidFile = (await readFile(join(directory, 'postmaster.pid'), 'utf8')).split('\n');
    const postmaster = Number(pidFile[0]);
    const port = Number(pidFile[3]);
    pids = [postmaster, ...await descendants(postmaster)];
    owner.kill('SIGTERM');
    await expect.poll(async () => { const states = await Promise.all(pids.map(alive)); return pids.filter((_, index) => states[index]); }, { timeout: 10_000 }).toEqual([]);
    await expect.poll(() => listening(port), { timeout: 10_000 }).toBe(false);
  } finally {
    owner.kill('SIGTERM');
    await cleanup(directory);
    if (pids.length > 0) await expect.poll(async () => (await Promise.all(pids.map(alive))).some(Boolean), { timeout: 10_000 }).toBe(false);
  }
}, 120_000);

async function descendants(pid: number) {
  const children: number[] = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try { if (Number((await readFile(`/proc/${name}/stat`, 'utf8')).split(') ')[1]?.split(' ')[1]) === pid) children.push(Number(name)); } catch {}
  }
  return children;
}

function listening(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function cleanup(directory: string) {
  let pid: number;
  try { pid = Number((await readFile(join(directory, 'postmaster.pid'), 'utf8')).split('\n')[0]); } catch { return; }
  if (!await alive(pid)) return;
  const binary = require.resolve(`@embedded-postgres/${process.platform}-${process.arch}`, { paths: [dirname(require.resolve('embedded-postgres'))] });
  const control = join(dirname(binary), '..', 'native', 'bin', 'pg_ctl');
  await exec(control, ['stop', '-D', directory, '-m', 'immediate', '-w', '-t', '15']);
}

test('PostgreSQL and its workers exit after forced owner termination', async () => {
    await mkdir('.artifacts', { recursive: true });
    const directory = join(await mkdtemp(resolve('.artifacts/database-owner-')), 'postgres');
    const owner = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/database-owner.ts'), directory], { stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = '';
    owner.stderr.on('data', (data) => { diagnostics += String(data); });
    let port = 0;
    let url = '';
    let pids: number[] = [];
    try {
      await expect.poll(async () => {
        if (owner.exitCode !== null) throw new Error(`Database owner exited: ${diagnostics}`);
        try {
          const ready = z.object({ url: z.url() }).parse(JSON.parse(await readFile(join(directory, 'owner-ready.json'), 'utf8')));
          url = ready.url;
          port = Number(new URL(ready.url).port);
          return true;
        } catch { return false; }
      }, { timeout: 75_000 }).toBe(true);
      const postmaster = Number((await readFile(join(directory, 'postmaster.pid'), 'utf8')).split('\n')[0]);
      pids = [postmaster, ...await descendants(postmaster)];
      expect(pids.length).toBeGreaterThan(1);
      expect(await listening(port)).toBe(true);
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try { await client.query("CREATE TABLE saved_value (value text); INSERT INTO saved_value VALUES ('survives owner death')"); }
      finally { await client.end(); }
      owner.kill('SIGKILL');
      await expect.poll(async () => { const states = await Promise.all(pids.map(alive)); return pids.filter((_, index) => states[index]); }, { timeout: 10_000 }).toEqual([]);
      await expect.poll(() => listening(port), { timeout: 10_000 }).toBe(false);
      const restarted = await startDatabase(directory);
      const restored = new pg.Client({ connectionString: restarted.url });
      try {
        await restored.connect();
        expect((await restored.query('SELECT value FROM saved_value')).rows).toEqual([{ value: 'survives owner death' }]);
      } finally { await restored.end(); await restarted.stop(); }
    } finally {
      owner.kill('SIGKILL');
      await cleanup(directory);
      if (pids.length > 0) await expect.poll(async () => (await Promise.all(pids.map(alive))).some(Boolean), { timeout: 10_000 }).toBe(false);
    }
  }, 190_000);
