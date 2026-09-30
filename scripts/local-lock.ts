import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { createServer } from 'node:net';

export async function acquireLocalLock(root: string) {
  const name = '\0vibe-bench-' + createHash('sha256').update(await realpath(root)).digest('hex');
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(name, resolve);
  }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') throw new Error('Local server is already running for this state directory');
    throw error;
  });
  let released: Promise<void> | undefined;
  return () => released ??= new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
