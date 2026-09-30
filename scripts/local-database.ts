import { access, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

export async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No local TCP port available');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

export async function startDatabase(directory: string) {
  await mkdir(directory, { recursive: true });
  const port = await unusedPort();
  const database = new EmbeddedPostgres({ databaseDir: directory, user: 'vibe', password: 'local-only', port, persistent: true, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  try { await access(join(directory, 'PG_VERSION')); } catch { await database.initialise(); }
  await database.start();
  return { url: `postgres://vibe:local-only@127.0.0.1:${port}/postgres`, stop: () => database.stop() };
}
