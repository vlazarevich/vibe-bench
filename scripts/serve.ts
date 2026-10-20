import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createWorkerApp } from '../apps/server/src/worker-app.ts';
import { createApp } from '../apps/server/src/app.ts';
import { dashboardConfig } from './dashboard-config.ts';
import { startDatabase } from './local-database.ts';
import { acquireLocalLock } from './local-lock.ts';

declare const __VIBE_BUNDLED__: boolean | undefined;
const bundled = typeof __VIBE_BUNDLED__ === 'boolean' && __VIBE_BUNDLED__;
const webRoot = fileURLToPath(new URL(bundled ? '../web/' : '../dist/web/', import.meta.url));

const config = dashboardConfig();
let releaseLock = async () => {};
if (config.database.kind === 'embedded') {
  await mkdir(config.database.root, { recursive: true });
  releaseLock = await acquireLocalLock(config.database.root);
}
let stop = async () => {};
let stopping = false;
const startup = (async () => {
  let url: string;
  let stopDatabase = async () => {};
  if (config.database.kind === 'embedded') {
    const database = await startDatabase(join(config.database.root, 'postgres'));
    url = database.url;
    stopDatabase = database.stop;
    stop = stopDatabase;
    if (stopping) return;
  } else url = config.database.url;
  const pool = await connectDatabase(url);
  stop = async () => { await pool.end(); await stopDatabase(); };
  if (stopping) return;
  let ready = false;
  const app = await createApp({ pool, webRoot, ready: () => ready });
  const worker = config.worker ? createWorkerApp({ pool }) : undefined;
  stop = async () => { await worker?.close(); await app.close(); await pool.end(); await stopDatabase(); };
  if (worker && config.worker) await worker.listen(config.worker);
  if (stopping) return;
  const address = await app.listen({ host: config.host, port: config.port });
  ready = true;
  const state = config.database.kind === 'embedded' ? `State: ${config.database.root}` : 'Database: external PostgreSQL';
  process.stdout.write(`Vibe bench ready at ${address}\n${state}\n`);
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
