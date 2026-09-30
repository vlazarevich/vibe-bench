import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AttemptId, Entrant, Model, Report, ReportId, RunId, Task } from '../../../packages/contracts/src/runner.ts';

const Attempt = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pending'), attemptId: AttemptId, model: Model }).strict(),
  z.object({ kind: z.literal('started'), attemptId: AttemptId, model: Model }).strict(),
  z.object({ kind: z.literal('finished'), result: Entrant }).strict(),
]);
export const Progress = z.object({ protocol: z.literal(1), reportId: ReportId, runId: RunId, source: z.enum(['fixture', 'live']), createdAt: z.iso.datetime(), task: Task, attempts: z.tuple([Attempt, Attempt]) }).strict();
export type Progress = z.infer<typeof Progress>;

export async function durableWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
}

export async function loadReport(path: string) {
  return Report.parse(JSON.parse(await readFile(path, 'utf8')));
}
