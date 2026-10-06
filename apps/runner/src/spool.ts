import { link, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
async function syncDirectory(path: string) {
  await using directory = await open(path, 'r');
  await directory.sync();
}

export async function durableDirectory(path: string) {
  const absolute = resolve(path);
  const first = await mkdir(absolute, { recursive: true, mode: 0o700 });
  if (!first) return;
  const parent = dirname(first);
  for (let directory = absolute; ; directory = dirname(directory)) {
    await syncDirectory(directory);
    if (directory === parent) break;
  }
}

export async function durableWrite(path: string, value: unknown, mode: 'replace' | 'create' = 'replace') {
  await durableDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const content = JSON.stringify(value, null, 2);
  const file = await open(temporary, 'wx', 0o600);
  try {
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    if (mode === 'replace') await rename(temporary, path);
    else {
      try { await link(temporary, path); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        if (await readFile(path, 'utf8') !== content) throw new Error('Saved file conflicts with the new value');
      }
    }
  } finally { await rm(temporary, { force: true }); await syncDirectory(dirname(path)); }
}
