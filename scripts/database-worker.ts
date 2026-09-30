import { access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

const [directory, port] = z.tuple([z.string().min(1), z.coerce.number().int().min(1).max(65535)]).parse(process.argv.slice(2));
let stopping = false;
let requestStop = () => { stopping = true; };
const stopped = new Promise<void>((resolve) => { requestStop = () => { stopping = true; resolve(); }; });
process.stdin.on('data', requestStop);
process.stdin.once('end', requestStop);
process.once('SIGINT', requestStop);
process.once('SIGTERM', requestStop);
process.stdout.on('error', requestStop);
process.stderr.on('error', requestStop);
const record = (message: unknown) => { if (!process.stderr.destroyed) process.stderr.write(String(message)); };
const url = `postgres://vibe:local-only@127.0.0.1:${port}/postgres`;
const database = new EmbeddedPostgres({ databaseDir: directory, user: 'vibe', password: 'local-only', port, persistent: true, initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1'], onLog: record, onError: record });
try {
  await mkdir(dirname(directory), { recursive: true });
  try { await access(join(directory, 'PG_VERSION')); } catch { await database.initialise(); }
  if (!stopping) {
    await database.start();
    const deadline = performance.now() + 30_000;
    while (!stopping) {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000, query_timeout: 1000 });
      try { await client.connect(); await client.query('SELECT 1'); break; }
      catch (error) { if (performance.now() >= deadline) throw error; await setTimeout(50); }
      finally { await client.end(); }
    }
    if (!stopping) process.stdout.write(JSON.stringify({ kind: 'ready', url }) + '\n');
    await stopped;
  }
} finally {
  await database.stop();
  process.stdin.destroy();
}
