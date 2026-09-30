import { randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import type pg from 'pg';
import { z } from 'zod';
import { RuntimeRegistration } from '../../../packages/contracts/src/runtime.ts';
import { registerRuntime, listRuntimes } from './features/runtimes.ts';
import { Conflict, NotFound } from './errors.ts';
import { Report } from '../../../packages/contracts/src/runner.ts';
import { Choice, SessionId, Runs } from '../../../packages/contracts/src/evaluation.ts';
import { acceptReport, listRuns } from './features/runs.ts';
import { createEvaluation, readEvaluation, saveChoice } from './features/evaluation.ts';
import { ContentId, CreateSuite, SaveSuite, SuiteId, SuiteView, SuiteHistory } from '../../../packages/contracts/src/suites.ts';
import { createSuite, listSuites, readSuite, readSuiteContent, saveSuite, suiteHistory } from './features/suites.ts';

export async function createApp({ pool, token, webRoot, ready = () => true }: { pool: pg.Pool; token: string; webRoot?: string; ready?: () => boolean }) {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = request.headers.host;
    if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return reply.code(403).send({ error: 'Local access only' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.url !== '/api/runner/reports' && request.url !== '/api/worker/registrations' && request.headers.origin !== `http://${host}`) return reply.code(403).send({ error: 'Same-origin request required' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    if (error instanceof Conflict) return reply.code(409).send({ error: error.message });
    if (error instanceof NotFound) return reply.code(404).send({ error: 'Not found' });
    if (error instanceof Error && 'statusCode' in error) {
      if (error.statusCode === 400) return reply.code(400).send({ error: 'Invalid request' });
      if (error.statusCode === 413) return reply.code(413).send({ error: 'Request too large' });
      if (error.statusCode === 415) return reply.code(415).send({ error: 'Unsupported media type' });
    }
    return reply.code(500).send({ error: 'Request failed' });
  });
  app.get('/api/health', async (_request, reply) => { if (!ready()) return reply.code(503).send({ ok: false }); await pool.query('SELECT 1'); return { ok: true }; });
  app.post('/api/runner/reports', { bodyLimit: 2_100_000 }, async (request, reply) => {
    const provided = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply.code(401).send({ error: 'Unauthorized' });
    return acceptReport(pool, Report.parse(request.body));
  });
  app.post('/api/worker/registrations', async (request) => registerRuntime(pool, RuntimeRegistration.parse(request.body)));
  app.get('/api/runtimes', async () => listRuntimes(pool));
  app.get('/api/runs', async () => Runs.parse(await listRuns(pool)));
  app.get('/api/suites', async () => listSuites(pool));
  app.post('/api/suites', async (request) => SuiteView.parse(await createSuite(pool, CreateSuite.parse(request.body))));
  app.get('/api/suites/:id', async (request) => SuiteView.parse(await readSuite(pool, z.object({ id: SuiteId }).parse(request.params).id)));
  app.post('/api/suites/:id', async (request) => SuiteView.parse(await saveSuite(pool, z.object({ id: SuiteId }).parse(request.params).id, SaveSuite.parse(request.body))));
  app.get('/api/suites/:id/history', async (request) => SuiteHistory.parse(await suiteHistory(pool, z.object({ id: SuiteId }).parse(request.params).id)));
  app.get('/api/suites/:id/contents/:contentId', async (request) => {
    const params = z.object({ id: SuiteId, contentId: ContentId }).parse(request.params);
    return readSuiteContent(pool, params.id, params.contentId);
  });
  app.post('/api/evaluations', async (request, reply) => {
    const { reviewId } = z.object({ reviewId: z.uuid() }).strict().parse(request.body);
    const existing = z.string().regex(/^[a-f0-9]{64}$/).safeParse(request.cookies.vibe_authority);
    const authority = existing.success ? existing.data : randomBytes(32).toString('hex');
    const id = await createEvaluation(pool, reviewId, authority);
    reply.setCookie('vibe_authority', authority, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 });
    return readEvaluation(pool, id, authority);
  });
  app.get('/api/evaluations/:id', async (request) => {
    const { id } = z.object({ id: SessionId }).parse(request.params);
    return readEvaluation(pool, id, request.cookies.vibe_authority ?? '');
  });
  app.post('/api/evaluations/:id/choice', async (request) => {
    const { id } = z.object({ id: SessionId }).parse(request.params);
    const { handle } = Choice.parse(request.body);
    return saveChoice(pool, id, request.cookies.vibe_authority ?? '', handle);
  });
  if (webRoot) {
    await app.register(staticFiles, { root: webRoot });
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  }
  return app;
}
