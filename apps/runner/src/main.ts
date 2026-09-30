import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { configuredModels, configuredTask, Connection, deliverSaved, executeRun, retryReports } from './runner.ts';

try {
  const mode = z.enum(['fixture', 'live', 'retry']).parse(process.argv[2]);
  const localRoot = resolve(process.env.VIBE_LOCAL_ROOT ?? '.local');
  const connection = Connection.parse(JSON.parse(await readFile(resolve(localRoot, 'instance.json'), 'utf8')));
  const stateRoot = resolve(localRoot, 'runner');
  if (mode === 'retry') {
    const summary = await retryReports(stateRoot, connection);
    process.stdout.write(`${JSON.stringify(summary)}\nUncertain attempts are retained and never relaunched.\n`);
  } else {
    const result = await executeRun({ source: mode, stateRoot, models: mode === 'fixture' ? ['gpt-6-luna', 'gpt-6-sol'] : configuredModels(), task: await configuredTask(), ...(process.env.VIBE_CODEX_BIN ? { executable: process.env.VIBE_CODEX_BIN } : {}), timeoutMs: z.coerce.number().int().min(100).max(600_000).parse(process.env.VIBE_TIMEOUT_MS ?? 180_000) });
    await deliverSaved(result.directory, connection);
    process.stdout.write(`Saved ${mode} run ${result.report.runId}. Open ${connection.url}\n`);
    if (result.report.entrants.some((e) => e.outcome.kind === 'failed')) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Runner failed'}\n`);
  process.exitCode = 1;
}
