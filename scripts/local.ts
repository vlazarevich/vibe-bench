import { open, readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { startDatabase } from './local-database.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { createApp } from '../apps/server/src/app.ts';
import { configuredTask, deliverSaved, executeRun } from '../apps/runner/src/runner.ts';
import { durableWrite } from '../apps/runner/src/spool.ts';
import { mkdir } from 'node:fs/promises';

const root = resolve(process.env.VIBE_LOCAL_ROOT ?? '.local');
await mkdir(root, { recursive: true });
const lockPath = resolve(root, 'server.lock');
try {
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid)); await lock.close();
} catch {
  const pid = Number(await readFile(lockPath, 'utf8'));
  try { process.kill(pid, 0); throw new Error(`Local server is already running with PID ${pid}`); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    await rm(lockPath);
    const lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); await lock.close();
  }
}
let stop = async () => { await rm(lockPath, { force: true }); };
try {
  const database = await startDatabase(resolve(root, 'postgres'));
  stop = async () => { await database.stop(); await rm(lockPath, { force: true }); };
  const pool = await connectDatabase(database.url);
  stop = async () => { await pool.end(); await database.stop(); await rm(lockPath, { force: true }); };
  const token = randomBytes(32).toString('hex');
  let ready = false;
  const app = await createApp({ pool, token, webRoot: resolve('dist/web'), ready: () => ready });
  stop = async () => { await app.close(); await pool.end(); await database.stop(); await rm(lockPath, { force: true }); };
  const url = await app.listen({ host: '127.0.0.1', port: Number(process.env.VIBE_PORT ?? 0) });
  await durableWrite(resolve(root, 'instance.json'), { url, token });
  if (process.argv.includes('--fixture')) {
    const run = await executeRun({ source: 'fixture', stateRoot: resolve(root, 'runner'), models: ['gpt-6-luna', 'gpt-6-sol'], task: await configuredTask() });
    await deliverSaved(run.directory, { url, token });
  }
  ready = true;
  process.stdout.write(`Vibe bench ready at ${url}\nState: ${root}\n`);
  let stopping = false;
  const shutdown = () => { if (!stopping) { stopping = true; void stop().then(() => process.exit(0), (error: unknown) => { process.stderr.write(String(error)); process.exit(1); }); } };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
} catch (error) { await stop(); throw error; }
