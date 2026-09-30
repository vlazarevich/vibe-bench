import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Entrant, Model, Outcome, Receipt, Report, ReportId, RunId, Task, prepareSnapshot } from '../../../packages/contracts/src/runner.ts';
import { Text } from '../../../packages/contracts/src/text.ts';
import { PinnedSuiteTask } from '../../../packages/contracts/src/suites.ts';
import { durableDirectory, durableWrite, loadReport, Progress } from './spool.ts';
import { Interrupted, readBounded, runProcess } from './processes/run.ts';

export const defaultTask = { title: 'Explain database indexes', prompt: 'Explain how a database index speeds up a lookup to a curious beginner. Use one concrete everyday analogy and include one tradeoff. Keep the answer under 150 words. Return only the answer as plain text. Do not use tools, inspect files, or identify your model.' };
export const Connection = z.object({ url: z.url(), token: z.string().min(32) });
export type Connection = z.infer<typeof Connection>;

export function childEnvironment(): NodeJS.ProcessEnv {
  const names = ['PATH', 'HOME', 'TMPDIR', 'CODEX_HOME', 'OPENAI_API_KEY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
}

export async function uploadReport(report: Report, connection: Connection) {
  const response = await fetch(new URL('/api/runner/reports', connection.url), { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Report upload failed with HTTP ${response.status}. Retry the saved report.`);
  const receipt = Receipt.parse(await response.json());
  if (receipt.reportId !== report.reportId || receipt.runId !== report.runId) throw new Error('Report receipt does not match');
  return receipt;
}

export async function executeRun({ source, stateRoot, models, task = defaultTask, executable, pinned, timeoutMs = 180_000 }: { source: 'fixture' | 'live'; stateRoot: string; models: [Model, Model]; task?: z.infer<typeof Task>; executable?: string; pinned?: PinnedSuiteTask; timeoutMs?: number }) {
  const snapshot = prepareSnapshot({ task: Task.parse(task), models, timeoutMs, ...(pinned ? { pinned: PinnedSuiteTask.parse(pinned) } : {}) });
  const validatedTask = snapshot.task;
  const command = source === 'fixture' ? process.execPath : executable;
  if (!command || !isAbsolute(command)) throw new Error('Set VIBE_CODEX_BIN to an absolute native Codex executable path');
  await access(command);
  const prefix = source === 'fixture' ? [fileURLToPath(new URL('../../../tests/fixtures/codex.mjs', import.meta.url))] : [];
  const progress = Progress.parse({ protocol: 2, snapshot, reportId: randomUUID(), runId: randomUUID(), source, createdAt: new Date().toISOString(), task: validatedTask, attempts: snapshot.models.map((model) => ({ kind: 'pending', model, attemptId: randomUUID() })) });
  const directory = resolve(stateRoot, progress.runId);
  await durableDirectory(directory);
  await durableWrite(join(directory, 'progress.json'), progress);
  const env = childEnvironment();
  const versionDirectory = join(directory, 'version');
  await mkdir(versionDirectory);
  const versionResult = await runProcess({ executable: command, args: [...prefix, '--version'], cwd: versionDirectory, directory: versionDirectory, input: '', timeoutMs: 30_000, env });
  if (versionResult.kind !== 'exited' || versionResult.code !== 0) throw new Error('Could not read CLI version. Local progress is retained.');
  const cliVersion = Entrant.shape.cliVersion.parse((await readBounded(join(versionDirectory, 'stdout.log'), 200)).trim());
  if (source === 'live' && cliVersion !== 'codex-cli 0.159.2') throw new Error(`Unsupported CLI version ${cliVersion}. This adapter is verified with codex-cli 0.159.2.`);
  for (const index of [0, 1] satisfies Array<0 | 1>) {
    const attempt = progress.attempts[index];
    if (attempt.kind !== 'pending') throw new Error('An existing attempt must never be relaunched');
    const attemptDirectory = join(directory, attempt.attemptId);
    const workspace = join(attemptDirectory, 'workspace');
    await mkdir(workspace, { recursive: true });
    progress.attempts[index] = { ...attempt, kind: 'started' };
    await durableWrite(join(directory, 'progress.json'), progress);
    const finalPath = join(attemptDirectory, 'answer.txt');
    let outcome: Outcome;
    try {
      const result = await runProcess({ executable: command, args: [...prefix, 'exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral', '--model', attempt.model, '--sandbox', 'read-only', '--output-last-message', finalPath, '--json', '-'], cwd: workspace, directory: attemptDirectory, input: validatedTask.prompt, timeoutMs: snapshot.settings.timeoutMs, env });
      if (result.kind === 'timeout') outcome = { kind: 'failed', reason: 'timeout', detail: 'The process tree exceeded its deadline and was stopped.' };
      else if (result.kind === 'output-limit') outcome = { kind: 'failed', reason: 'output-limit', detail: 'Process output exceeded the local limit.' };
      else if (result.code !== 0) outcome = { kind: 'failed', reason: 'exit', detail: `CLI exited with code ${result.code}. Inspect local stderr.log.` };
      else {
        const text = await readBounded(finalPath);
        const events = await readBounded(join(attemptDirectory, 'stdout.log'), 500_000);
        const completed = events.split(/\r?\n/).some((line) => { try { return z.object({ type: z.literal('turn.completed') }).safeParse(JSON.parse(line)).success; } catch { return false; } });
        const answer = Outcome.safeParse({ kind: 'succeeded', text });
        outcome = text.trim() && completed && answer.success ? answer.data : { kind: 'failed', reason: 'missing-output', detail: 'CLI did not produce a complete final text result.' };
      }
    } catch (error) { if (error instanceof Interrupted) throw error; outcome = { kind: 'failed', reason: 'process', detail: Text.max(2000).safeParse(error instanceof Error ? error.message.slice(0, 2000) : '').data || 'Process failed' }; }
    progress.attempts[index] = { kind: 'finished', result: { attemptId: attempt.attemptId, model: attempt.model, cliVersion, outcome } };
    await durableWrite(join(directory, 'progress.json'), progress);
  }
  const [first, second] = progress.attempts;
  if (first.kind !== 'finished' || second.kind !== 'finished') throw new Error('Run is incomplete');
  const report = Report.parse({ protocol: 2, snapshot, reportId: ReportId.parse(progress.reportId), runId: RunId.parse(progress.runId), source, createdAt: progress.createdAt, task: progress.task, entrants: [first.result, second.result] });
  await durableWrite(join(directory, 'report.json'), report);
  return { report, directory };
}

export async function deliverSaved(directory: string, connection: Connection) {
  const report = await loadReport(join(directory, 'report.json'));
  const receipt = await uploadReport(report, connection);
  await durableWrite(join(directory, 'receipt.json'), receipt, 'create');
  return report;
}

export async function retryReports(stateRoot: string, connection: Connection) {
  await mkdir(stateRoot, { recursive: true });
  const summary = { delivered: 0, uncertain: 0 };
  for (const item of await readdir(stateRoot)) {
    if (!RunId.safeParse(item).success) continue;
    const directory = join(stateRoot, item);
    if (!(await stat(directory)).isDirectory()) continue;
    try { await access(join(directory, 'receipt.json')); continue; } catch {}
    try { await access(join(directory, 'report.json')); } catch { summary.uncertain++; continue; }
    await deliverSaved(directory, connection);
    summary.delivered++;
  }
  return summary;
}

export async function configuredTask() {
  return process.env.VIBE_TASK_FILE ? Task.parse({ title: 'Local text task', prompt: await readFile(process.env.VIBE_TASK_FILE, 'utf8') }) : defaultTask;
}

export function configuredModels(): [Model, Model] {
  return [Model.parse(process.env.VIBE_MODEL_A), Model.parse(process.env.VIBE_MODEL_B)];
}

export async function configuredSuite() {
  if (!process.env.VIBE_SUITE_FILE) return undefined;
  if (process.env.VIBE_TASK_FILE) throw new Error('Choose VIBE_SUITE_FILE or VIBE_TASK_FILE, not both');
  return PinnedSuiteTask.parse(JSON.parse(await readFile(process.env.VIBE_SUITE_FILE, 'utf8')));
}
