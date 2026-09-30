import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { acquireLocalLock } from '../scripts/local-lock.ts';

async function owner(root: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/lock-owner.ts'), root], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const ready = new Promise<boolean>((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', () => resolve(true));
    child.once('close', () => resolve(false));
  });
  return { child, closed, ready };
}

test('concurrent owners exclude each other and process death releases ownership', async () => {
  await mkdir('.artifacts', { recursive: true });
  const root = await mkdtemp(resolve('.artifacts/lock-'));
  await writeFile(join(root, 'server.lock'), '');
  const owners = await Promise.all([owner(root), owner(root)]);
  try {
    const readiness = await Promise.all(owners.map((value) => value.ready));
    expect(readiness.filter(Boolean)).toHaveLength(1);
    await expect(acquireLocalLock(root)).rejects.toThrow('already running');
    for (const value of owners) value.child.kill('SIGKILL');
    await Promise.all(owners.map((value) => value.closed));
    const release = await acquireLocalLock(root);
    await release(); await release();
  } finally {
    for (const value of owners) value.child.kill('SIGKILL');
    await Promise.all(owners.map((value) => value.closed));
  }
});

test('canonical roots share ownership and separate state directories stay independent', async () => {
  const root = await mkdtemp(resolve('.artifacts/lock-roots-'));
  const directory = join(root, 'state'), alias = join(root, 'alias'), other = join(root, 'other');
  await mkdir(directory); await mkdir(other); await symlink(directory, alias);
  const release = await acquireLocalLock(directory);
  try {
    await expect(acquireLocalLock(alias)).rejects.toThrow('already running');
    const releaseOther = await acquireLocalLock(other); await releaseOther();
  } finally { await release(); }
  const releaseAlias = await acquireLocalLock(alias); await releaseAlias();
});
