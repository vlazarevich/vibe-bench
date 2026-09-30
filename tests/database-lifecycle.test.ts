import { expect, test } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { z } from 'zod';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);

async function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return process.platform !== 'linux' || !/\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'));
  } catch { return false; }
}

async function descendants(pid: number) {
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | Select-Object -ExpandProperty ProcessId`], { windowsHide: true });
    return stdout.trim().split(/\s+/).map(Number).filter((id) => id > 0);
  }
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
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const binary = require.resolve(`@embedded-postgres/${platform}-${process.arch}`, { paths: [dirname(require.resolve('embedded-postgres'))] });
  const control = join(dirname(binary), '..', 'native', 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  await exec(control, ['stop', '-D', directory, '-m', 'immediate', '-w', '-t', '15'], { windowsHide: true });
}

for (const mode of process.platform === 'win32' ? ['owner', 'tree'] : ['owner']) {
  test(`PostgreSQL and its workers exit after forced ${mode} termination`, async () => {
    await mkdir('.artifacts', { recursive: true });
    const directory = join(await mkdtemp(resolve('.artifacts/database-owner-')), 'postgres');
    const owner = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/database-owner.ts'), directory], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let diagnostics = '';
    owner.stderr.on('data', (data) => { diagnostics += String(data); });
    let port = 0;
    let pids: number[] = [];
    try {
      await expect.poll(async () => {
        if (owner.exitCode !== null) throw new Error(`Database owner exited: ${diagnostics}`);
        try {
          const ready = z.object({ url: z.url() }).parse(JSON.parse(await readFile(join(directory, 'owner-ready.json'), 'utf8')));
          port = Number(new URL(ready.url).port);
          return true;
        } catch { return false; }
      }, { timeout: 75_000 }).toBe(true);
      const postmaster = Number((await readFile(join(directory, 'postmaster.pid'), 'utf8')).split('\n')[0]);
      pids = [postmaster, ...await descendants(postmaster)];
      expect(pids.length).toBeGreaterThan(1);
      expect(await listening(port)).toBe(true);
      if (mode === 'tree') await exec('taskkill', ['/PID', String(owner.pid), '/T', '/F'], { windowsHide: true });
      else owner.kill('SIGKILL');
      await expect.poll(async () => { const states = await Promise.all(pids.map(alive)); return pids.filter((_, index) => states[index]); }, { timeout: 10_000 }).toEqual([]);
      expect(await listening(port)).toBe(false);
    } finally {
      owner.kill('SIGKILL');
      await cleanup(directory);
      if (pids.length > 0) await expect.poll(async () => (await Promise.all(pids.map(alive))).some(Boolean), { timeout: 10_000 }).toBe(false);
    }
  }, 110_000);
}
