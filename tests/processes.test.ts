import { expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runProcess } from '../apps/runner/src/processes/run.ts';
import { childEnvironment } from '../apps/runner/src/runner.ts';
import { spawn } from 'node:child_process';

async function alive(pid: number) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux' && /\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'))) return false;
    return true;
  } catch { return false; }
}

test('stops descendants when the owning runner is interrupted', async () => {
  await mkdir('.artifacts', { recursive: true });
  const directory = await mkdtemp(resolve('.artifacts/interrupted-'));
  const driver = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/process-driver.ts'), directory], { stdio: 'ignore' });
  let pid = 0;
  await expect.poll(async () => { try { pid = Number(await readFile(join(directory, 'child.pid'), 'utf8')); return pid > 0; } catch { return false; } }, { timeout: 15_000 }).toBe(true);
  driver.kill('SIGTERM');
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
});

for (const mode of ['timeout', 'exit']) {
  test(`terminates real descendants on ${mode}`, async () => {
    await mkdir('.artifacts', { recursive: true });
    const directory = await mkdtemp(resolve('.artifacts/process-'));
    const pidFile = join(directory, 'child.pid');
    const result = await runProcess({ executable: process.execPath, args: [resolve('tests/fixtures/process-tree.mjs'), pidFile, mode], cwd: directory, directory, input: '', timeoutMs: 1500, env: childEnvironment() });
    expect(result).toEqual(mode === 'timeout' ? { kind: 'timeout' } : { kind: 'exited', code: 0 });
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false);
  });
}
