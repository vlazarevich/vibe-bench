import Fastify from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { registerWorkerRoutes } from './worker-routes.ts';
import { Unauthorized } from './features/access.ts';
import { Conflict, NotFound } from './errors.ts';

export function createWorkerApp({ pool }: { pool: pg.Pool }) {
  const app = Fastify({ logger: false, bodyLimit: 32_000 });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin || request.headers['sec-fetch-site'] || request.headers['sec-fetch-dest'] || request.headers['sec-fetch-user']) return reply.code(403).send({ error: 'Worker requests only' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request' });
    if (error instanceof NotFound) return reply.code(404).send({ error: 'Not found' });
    if (error instanceof Unauthorized) return reply.code(401).send({ error: 'Unauthorized' });
    if (error instanceof Conflict) return reply.code(409).send({ error: error.message });
    if (error instanceof Error && 'statusCode' in error) {
      if (error.statusCode === 400) return reply.code(400).send({ error: 'Invalid request' });
      if (error.statusCode === 413) return reply.code(413).send({ error: 'Request too large' });
      if (error.statusCode === 415) return reply.code(415).send({ error: 'Unsupported media type' });
    }
    return reply.code(500).send({ error: 'Request failed' });
  });
  registerWorkerRoutes(app, pool);
  return app;
}
