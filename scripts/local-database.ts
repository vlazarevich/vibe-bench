import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local TCP port available');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function startDatabase(directory: string) {
  const port = await unusedPort();
  const worker = fileURLToPath(new URL('./database-worker.ts', import.meta.url));
  const args = ['--import', 'tsx', worker, directory, String(port)];
  const windows = process.platform === 'win32';
  const executable = windows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : process.execPath;
  const command = windows ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./windows-database-job.ps1', import.meta.url)), '-NodePath', process.execPath, '-WorkerPath', worker, '-Directory', directory, '-Port', String(port), '-OwnerPid', String(process.pid)] : args;
  const child = spawn(executable, command, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !windows });
  let diagnostics = '';
  child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + String(chunk)).slice(-8000); });
  child.stdin.on('error', (error) => { diagnostics = (diagnostics + String(error)).slice(-8000); });
  const exited = new Promise<number | null>((resolve) => { child.once('close', resolve); child.once('error', () => resolve(null)); });
  const terminate = () => {
    if (windows) child.kill('SIGKILL');
    else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; } }
  };
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise<string>((resolve, reject) => {
    lines.once('line', (line) => {
      try { resolve(z.object({ kind: z.literal('ready'), url: z.url() }).strict().parse(JSON.parse(line)).url); } catch (error) { reject(error); }
    });
    child.once('error', reject);
    void exited.then((code) => reject(new Error(`PostgreSQL worker exited before readiness (${code}): ${diagnostics}`)));
  });
  const startupDeadline = setTimeout(terminate, 90_000);
  let url: string;
  try { url = await ready; } catch (error) { terminate(); await exited; throw error; }
  finally { clearTimeout(startupDeadline); lines.close(); }
  let stopping: Promise<void> | undefined;
  return { url, stop: () => stopping ??= (async () => {
    child.stdin.end('stop\n');
    const deadline = setTimeout(terminate, 40_000);
    try { const code = await exited; if (code !== 0) throw new Error(`PostgreSQL shutdown failed (${code}): ${diagnostics}`); }
    finally { clearTimeout(deadline); }
  })() };
}
