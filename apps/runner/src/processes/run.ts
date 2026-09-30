import { spawn } from 'node:child_process';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProcessResult = { kind: 'exited'; code: number } | { kind: 'timeout' } | { kind: 'output-limit' };
const MAX_LOG_BYTES = 2_000_000;
const WINDOWS_SUPERVISOR_STARTUP_MS = 60_000;
export class Interrupted extends Error { constructor() { super('Run interrupted. Started attempts are retained and will not be relaunched.'); } }

export async function runProcess({ executable, args, cwd, directory, input, timeoutMs, env }: { executable: string; args: string[]; cwd: string; directory: string; input: string; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<ProcessResult> {
  const inputPath = join(directory, 'input.txt');
  const stdout = join(directory, 'stdout.log');
  const stderr = join(directory, 'stderr.log');
  await writeFile(inputPath, input, { mode: 0o600 });
  let limited = false;
  let interrupted = false;
  if (process.platform === 'win32') {
    const configPath = join(directory, 'process.json');
    await writeFile(configPath, JSON.stringify({ executable, arguments: args, cwd, input: inputPath, output: stdout, error: stderr, timeoutMs, parentPid: process.pid }), { mode: 0o600 });
    const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./windows-job.ps1', import.meta.url)), '-ConfigPath', configPath], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    helper.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    helper.stderr.setEncoding('utf8').on('data', (chunk: string) => { errorOutput += chunk; });
    const kill = () => { helper.kill(); };
    const interrupt = () => { interrupted = true; kill(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const monitor = setInterval(() => { void checkSize([stdout, stderr]).then((tooLarge) => { if (tooLarge) { limited = true; kill(); } }); }, 100);
    const watchdog = setTimeout(kill, timeoutMs + WINDOWS_SUPERVISOR_STARTUP_MS);
    try {
      const exit = await new Promise<number | null>((resolve, reject) => { helper.once('error', reject); helper.once('close', resolve); });
      if (interrupted) throw new Interrupted();
      if (limited) return { kind: 'output-limit' };
      if (exit !== 0) throw new Error(`Process supervisor failed: ${errorOutput.slice(0, 1000)}`);
      const code = Number(output.trim());
      if (!Number.isInteger(code)) throw new Error('Invalid process supervisor result');
      return code === 124 ? { kind: 'timeout' } : { kind: 'exited', code };
    } finally {
      clearInterval(monitor); clearTimeout(watchdog); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      await writeFile(join(directory, 'supervisor.log'), errorOutput, { mode: 0o600 });
    }
  }
  const handles = await Promise.all([open(inputPath, 'r'), open(stdout, 'w', 0o600), open(stderr, 'w', 0o600)]);
  const [stdinHandle, stdoutHandle, stderrHandle] = handles;
  if (!stdinHandle || !stdoutHandle || !stderrHandle) throw new Error('Missing process file handles');
  const child = spawn(executable, args, { cwd, env, detached: true, stdio: [stdinHandle.fd, stdoutHandle.fd, stderrHandle.fd] });
  let timedOut = false;
  const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; } } };
  const interrupt = () => { interrupted = true; kill(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  const monitor = setInterval(() => { void checkSize([stdout, stderr]).then((tooLarge) => { if (tooLarge) { limited = true; kill(); } }); }, 100);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    kill();
    if (interrupted) throw new Interrupted();
    if (limited) return { kind: 'output-limit' };
    if (timedOut) return { kind: 'timeout' };
    return { kind: 'exited', code: code ?? 1 };
  } finally { clearTimeout(timer); clearInterval(monitor); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); await Promise.all(handles.map((h) => h.close())); }
}

async function checkSize(paths: string[]) {
  const sizes = await Promise.all(paths.map(async (path) => { try { return (await stat(path)).size; } catch { return 0; } }));
  return sizes.some((size) => size > MAX_LOG_BYTES);
}

export async function readBounded(path: string, limit = 100_000) {
  if ((await stat(path)).size > limit * 4) throw new Error('Output is too large');
  return readFile(path, 'utf8');
}
