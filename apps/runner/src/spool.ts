import { link, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AttemptId, Entrant, Model, Report, ReportId, RunId, Snapshot, Task } from '../../../packages/contracts/src/runner.ts';

const Attempt = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pending'), attemptId: AttemptId, model: Model }).strict(),
  z.object({ kind: z.literal('started'), attemptId: AttemptId, model: Model }).strict(),
  z.object({ kind: z.literal('finished'), result: Entrant }).strict(),
]);
const progressFields = { reportId: ReportId, runId: RunId, source: z.enum(['fixture', 'live']), createdAt: z.iso.datetime(), task: Task, attempts: z.tuple([Attempt, Attempt]) };
export const Progress = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal(1), ...progressFields }).strict(),
  z.object({ protocol: z.literal(2), ...progressFields, snapshot: Snapshot }).strict(),
]);
export type Progress = z.infer<typeof Progress>;

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

export async function loadReport(path: string) {
  return Report.parse(JSON.parse(await readFile(path, 'utf8')));
}
