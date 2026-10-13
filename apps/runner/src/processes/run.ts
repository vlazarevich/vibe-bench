import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const executionSignal = new AsyncLocalStorage<AbortSignal>();
export class RunCancelled extends Error {
  constructor() {
    super('Run cancelled by dashboard');
  }
}

export type ProcessResult = { kind: 'exited'; code: number } | { kind: 'timeout' } | { kind: 'output-limit' };
const MAX_LOG_BYTES = 2_000_000;
export class Interrupted extends Error {
  constructor() {
    super('Run interrupted. Started attempts are retained and will not be relaunched.');
  }
}

export async function runProcess({
  executable,
  args,
  cwd,
  directory,
  input,
  timeoutMs,
  env,
  holdInputOpen = false,
}: {
  executable: string;
  args: string[];
  cwd: string;
  directory: string;
  input: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  holdInputOpen?: boolean;
}): Promise<ProcessResult> {
  const signal = executionSignal.getStore();
  if (signal?.aborted) throw new RunCancelled();
  const inputPath = join(directory, 'input.txt');
  const stdout = join(directory, 'stdout.log');
  const stderr = join(directory, 'stderr.log');
  await writeFile(inputPath, input, { mode: 0o600 });
  let limited = false;
  let interrupted = false;
  await using stdinHandle = await open(inputPath, 'r');
  await using stdoutHandle = await open(stdout, 'w', 0o600);
  await using stderrHandle = await open(stderr, 'w', 0o600);
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: true,
    stdio: [holdInputOpen ? 'pipe' : stdinHandle.fd, stdoutHandle.fd, stderrHandle.fd],
  });
  if (holdInputOpen) {
    child.stdin?.on('error', () => {});
    child.stdin?.write(input);
  }
  let timedOut = false;
  const kill = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    }
  };
  const abort = () => kill();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) kill();
  const interrupt = () => {
    interrupted = true;
    kill();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  const monitor = setInterval(() => {
    void checkSize([stdout, stderr]).then((tooLarge) => {
      if (tooLarge) {
        limited = true;
        kill();
      }
    });
  }, 100);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    kill();
    if (signal?.aborted) throw new RunCancelled();
    if (interrupted) throw new Interrupted();
    if (limited || (await checkSize([stdout, stderr]))) return { kind: 'output-limit' };
    if (timedOut) return { kind: 'timeout' };
    return { kind: 'exited', code: code ?? 1 };
  } finally {
    signal?.removeEventListener('abort', abort);
    clearTimeout(timer);
    clearInterval(monitor);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

async function checkSize(paths: string[]) {
  const sizes = await Promise.all(
    paths.map(async (path) => {
      try {
        return (await stat(path)).size;
      } catch {
        return 0;
      }
    }),
  );
  return sizes.some((size) => size > MAX_LOG_BYTES);
}

export async function readBounded(path: string, limit = 100_000) {
  if ((await stat(path)).size > limit * 4) throw new Error('Output is too large');
  const text = await readFile(path, 'utf8');
  if (text.length > limit) throw new Error('Output is too large');
  return text;
}
