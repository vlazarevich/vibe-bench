import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startDatabase } from './local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createWorkerApp } from '../apps/server/src/worker-app.ts';
import { z } from 'zod';
import { createApp } from '../apps/server/src/app.ts';
import { acquireLocalLock } from './local-lock.ts';

const workerConfig = process.env.VIBE_WORKER_HOST === undefined && process.env.VIBE_WORKER_PORT === undefined ? undefined : z.object({ host: z.string().min(1), port: z.coerce.number().int().min(1).max(65535) }).parse({ host: process.env.VIBE_WORKER_HOST, port: process.env.VIBE_WORKER_PORT });

const root = resolve(process.env.VIBE_LOCAL_ROOT ?? '.local');
await mkdir(root, { recursive: true });
const releaseLock = await acquireLocalLock(root);
let stop = async () => {};
let stopping = false;
const startup = (async () => {
  const database = await startDatabase(resolve(root, 'postgres'));
  stop = async () => { await database.stop(); };
  if (stopping) return;
  const pool = await connectDatabase(database.url);
  stop = async () => { await pool.end(); await database.stop(); };
  if (stopping) return;
  let ready = false;
  const app = await createApp({ pool, webRoot: resolve('dist/web'), ready: () => ready });
  const worker = workerConfig ? createWorkerApp({ pool }) : undefined;
  stop = async () => { await worker?.close(); await app.close(); await pool.end(); await database.stop(); };
  if (worker && workerConfig) await worker.listen(workerConfig);
  if (stopping) return;
  const url = await app.listen({ host: '127.0.0.1', port: Number(process.env.VIBE_PORT ?? 0) });
  ready = true;
  process.stdout.write(`Vibe bench ready at ${url}\nState: ${root}\n`);
})();
let stopped: Promise<void> | undefined;
const stopOnce = () => stopped ??= stop().finally(releaseLock);
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  void startup.catch(() => {}).then(stopOnce).then(() => process.exit(0), (error: unknown) => { process.stderr.write(String(error)); process.exit(1); });
};
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
try { await startup; } catch (error) { await stopOnce(); throw error; }
