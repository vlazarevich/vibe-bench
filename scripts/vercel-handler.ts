import { attachDatabasePool } from '@vercel/functions/db-connections';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/server/src/app.ts';
import { connectDatabase } from '../apps/server/src/db.ts';
import { vercelConfig } from './vercel-config.ts';

let application: Promise<Awaited<ReturnType<typeof createApp>>> | undefined;
async function start() {
  const config = vercelConfig();
  const pool = await connectDatabase(config.databaseUrl);
  // Keep the instance alive until released clients reach their idle timeout before suspension.
  attachDatabasePool(pool);
  try {
    const app = await createApp({ pool, password: config.password, publicUrl: config.publicUrl,
      trustedProxy: [], webRoot: fileURLToPath(new URL('./web/', import.meta.url)) });
    app.addHook('onClose', async () => { await pool.end(); });
    await app.ready();
    return app;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

/** One initialization per warm instance; concurrent cold requests share migrations and route registration. */
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    const app = await (application ??= start().catch((error: unknown) => { application = undefined; throw error; }));
    if (response.destroyed || response.writableEnded) return;
    // Pass the original stream and URL through Fastify. Do not buffer/inject responses: media can exceed 4.5 MB.
    await new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => { response.off('finish', done); response.off('close', done); response.off('error', failed); };
      response.once('finish', done);
      response.once('close', done);
      response.once('error', failed);
      app.server.emit('request', request, response);
    });
  } catch {
    // Database errors can contain connection details. Neither the response nor the log exposes them.
    process.stderr.write('Vercel dashboard request failed; check hosted settings and database availability.\n');
    if (!response.headersSent) {
      response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'Dashboard unavailable' }));
    } else response.destroy();
  }
}
