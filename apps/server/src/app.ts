import { registerGradingViewer } from './features/grading-viewer-routes.ts';
import { registerArtifactViewer } from './features/artifact-viewer-routes.ts';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import type pg from 'pg';
import { z } from 'zod';
import { ConfigureRun, CreateConfiguredRun, ConfiguredRunId } from '../../../packages/contracts/src/configured-runs.ts';
import { ApiUrl, CreateEnrollment } from '../../../packages/contracts/src/access.ts';
import { initializeAccess, createEnrollment, revokeRuntime, runtimeAccess, Unauthorized, Throttled } from './features/access.ts';
import { registerWorkerRoutes } from './worker-routes.ts';
import { previewRun, createConfiguredRun, listConfiguredRuns, readConfiguredRun, readArtifact } from './features/configured-runs.ts';
import { RuntimeId } from '../../../packages/contracts/src/runtime.ts';
import { listRuntimes } from './features/runtimes.ts';
import { BlindGradingSession, GradingReviewId, GradingSessionId, GradingTaskHandle, GradingAssetHandle, SaveJudgment } from '../../../packages/contracts/src/blind-grading.ts';
import { listGradingRuns, createGrading, readGrading, readGradingTask, saveGradingJudgment, readGradingAsset } from './features/blind-grading.ts';
import { Conflict, NotFound } from './errors.ts';
import { ContentId, CreateSuite, SaveSuite, SuiteId, SuiteView, SuiteHistory } from '../../../packages/contracts/src/suites.ts';
import { createSuite, listSuites, readSuite, readSuiteContent, saveSuite, suiteHistory } from './features/suites.ts';

export async function createApp({ pool, webRoot, ready = () => true, password = process.env.VIBE_APP_PASSWORD, publicUrl = process.env.VIBE_PUBLIC_URL, trustedProxy = process.env.VIBE_TRUSTED_PROXY?.split(',').map((value) => value.trim()) }: { pool: pg.Pool; webRoot?: string; ready?: () => boolean; password?: string; publicUrl?: string; trustedProxy?: string[] }) {
  const canonicalOrigin = publicUrl === undefined ? undefined : ApiUrl.parse(publicUrl);
  const access = await initializeAccess(pool, password);
  const secure = canonicalOrigin?.startsWith('https:') ?? false;
  const app = Fastify({ logger: false, bodyLimit: 1_000_000, trustProxy: trustedProxy ?? false });
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = request.headers.host;
    if (!host || (canonicalOrigin ? host !== new URL(canonicalOrigin).host : !/^(127\.0\.0\.1|localhost):\d+$/.test(host))) return reply.code(403).send({ error: 'Local access only' });
    if (request.url.startsWith('/api/worker/') && (request.headers.origin || request.headers['sec-fetch-site'] || request.headers['sec-fetch-dest'] || request.headers['sec-fetch-user'])) return reply.code(403).send({ error: 'Worker requests only' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !request.url.startsWith('/api/worker/') && request.headers.origin !== (canonicalOrigin ?? `http://${host}`)) return reply.code(403).send({ error: 'Same-origin request required' });
    const path = request.url.split('?')[0] ?? '';
    const publicPath = ['/api/health', '/api/access/session', '/api/access/login', '/api/access/logout', '/login', '/'].includes(path) || /^\/assets\/[a-zA-Z0-9._-]+$/.test(path);
    if (!publicPath && !path.startsWith('/api/worker/') && !await access.authenticated(request.cookies.vibe_session)) return reply.code(401).send({ error: 'Dashboard login required' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    if (error instanceof Unauthorized) return reply.code(401).send({ error: 'Unauthorized' });
    if (error instanceof Throttled) return reply.code(429).header('Retry-After', '900').send({ error: 'Too many login attempts. Try again later.' });
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
  registerWorkerRoutes(app, pool);
  app.get('/api/access/session', async (request) => ({ passwordRequired: access.passwordRequired, authenticated: await access.authenticated(request.cookies.vibe_session) }));
  app.post('/api/access/login', async (request, reply) => {
    const { password: value } = z.object({ password: z.string().max(1024) }).strict().parse(request.body);
    const session = await access.login(value, request.ip);
    reply.setCookie('vibe_session', session, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 12 * 60 * 60 });
    return { passwordRequired: access.passwordRequired, authenticated: true };
  });
  app.post('/api/access/logout', async (request, reply) => {
    await access.logout(request.cookies.vibe_session);
    reply.clearCookie('vibe_session', { httpOnly: true, sameSite: 'strict', secure, path: '/' });
    return { ok: true };
  });
  app.post('/api/runtime-enrollments', async (request) => createEnrollment(pool, CreateEnrollment.parse(request.body), canonicalOrigin ?? `http://${request.headers.host}`));
  app.get('/api/runtime-access', async () => runtimeAccess(pool));
  app.post('/api/runtimes/:id/revoke', async (request) => revokeRuntime(pool, z.object({ id: RuntimeId }).parse(request.params).id));
  app.post('/api/configured-runs/preview', async (request) => previewRun(pool, ConfigureRun.parse(request.body)));
  app.post('/api/configured-runs', async (request) => createConfiguredRun(pool, CreateConfiguredRun.parse(request.body)));
  app.get('/api/configured-runs', async () => listConfiguredRuns(pool));
  app.get('/api/configured-runs/:id', async (request) => readConfiguredRun(pool, z.object({ id: ConfiguredRunId }).parse(request.params).id));
  app.get('/api/configured-runs/:id/artifacts/:artifactId', async (request, reply) => {
    const params = z.object({ id: ConfiguredRunId, artifactId: z.uuid() }).parse(request.params);
    const bytes = await readArtifact(pool, params.id, params.artifactId);
    return reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', 'attachment; filename="artifact.bin"').header('X-Content-Type-Options', 'nosniff').send(bytes);
  });
  const previews = registerArtifactViewer(app, pool);
  registerGradingViewer(app, pool, previews);
  app.get('/api/blind-grading/runs', async () => listGradingRuns(pool));
  app.post('/api/blind-grading', async (request, reply) => {
    const { reviewId } = z.object({ reviewId: GradingReviewId }).strict().parse(request.body);
    const existing = z.string().regex(/^[a-f0-9]{64}$/).safeParse(request.cookies.vibe_grading_authority);
    const authority = existing.success ? existing.data : randomBytes(32).toString('hex');
    const id = await createGrading(pool, reviewId, authority);
    reply.setCookie('vibe_grading_authority', authority, { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
    return BlindGradingSession.parse(await readGrading(pool, id, authority));
  });
  app.get('/api/blind-grading/:id', async (request) => readGrading(pool, z.object({ id: GradingSessionId }).parse(request.params).id, request.cookies.vibe_grading_authority ?? ''));
  app.get('/api/blind-grading/:id/tasks/:task', async (request) => {
    const { id, task } = z.object({ id: GradingSessionId, task: GradingTaskHandle }).parse(request.params);
    return readGradingTask(pool, id, request.cookies.vibe_grading_authority ?? '', task);
  });
  app.post('/api/blind-grading/:id/judgments', async (request) => saveGradingJudgment(pool, z.object({ id: GradingSessionId }).parse(request.params).id, request.cookies.vibe_grading_authority ?? '', SaveJudgment.parse(request.body)));
  app.get('/api/blind-grading/:id/assets/:asset', async (request, reply) => {
    const { id, asset } = z.object({ id: GradingSessionId, asset: GradingAssetHandle }).parse(request.params);
    const result = await readGradingAsset(pool, id, request.cookies.vibe_grading_authority ?? '', asset);
    return reply.header('Content-Type', result.mediaType).header('Content-Disposition', `${result.previewable ? 'inline' : 'attachment'}; filename="result.bin"`).header('Content-Security-Policy', "sandbox; default-src 'none'").send(result.bytes);
  });
  app.get('/api/runtimes', async () => listRuntimes(pool));
  app.get('/api/suites', async () => listSuites(pool));
  app.post('/api/suites', async (request) => SuiteView.parse(await createSuite(pool, CreateSuite.parse(request.body))));
  app.get('/api/suites/:id', async (request) => SuiteView.parse(await readSuite(pool, z.object({ id: SuiteId }).parse(request.params).id)));
  app.post('/api/suites/:id', async (request) => SuiteView.parse(await saveSuite(pool, z.object({ id: SuiteId }).parse(request.params).id, SaveSuite.parse(request.body))));
  app.get('/api/suites/:id/history', async (request) => SuiteHistory.parse(await suiteHistory(pool, z.object({ id: SuiteId }).parse(request.params).id)));
  app.get('/api/suites/:id/contents/:contentId', async (request) => {
    const params = z.object({ id: SuiteId, contentId: ContentId }).parse(request.params);
    return readSuiteContent(pool, params.id, params.contentId);
  });
  if (webRoot) {
    await app.register(staticFiles, { root: webRoot });
    app.get('/login', (_request, reply) => reply.sendFile('index.html'));
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  }
  return app;
}
