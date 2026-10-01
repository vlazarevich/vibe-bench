import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { ConfiguredAttemptId, ConfiguredRunId } from '../../../../packages/contracts/src/configured-runs.ts';
import { PreviewInput, TextFile } from '../../../../packages/contracts/src/artifact-viewer.ts';
import { readAttemptResult } from './configured-runs.ts';
import { decodeText, htmlBundle, projectResult, type ResultLinks } from './artifact-viewer.ts';
import { HtmlPreviews, PreviewUnavailable } from './html-preview.ts';
import { NotFound } from '../errors.ts';

const Params = z.object({ id: ConfiguredRunId, attemptId: ConfiguredAttemptId });
const baseRoute = '/api/configured-runs/:id/attempts/:attemptId';
export function registerArtifactViewer(app: FastifyInstance, pool: pg.Pool) {
  const previews = new HtmlPreviews();
  app.addHook('onClose', () => previews.shutdown());
  const baseUrl = (params: z.infer<typeof Params>) => `/api/configured-runs/${params.id}/attempts/${params.attemptId}`;
  const links = (params: z.infer<typeof Params>): ResultLinks => ({ names: 'original', html: () => `${baseUrl(params)}/preview`, artifact: (id, purpose) => purpose === 'download' ? `/api/configured-runs/${params.id}/artifacts/${id}` : `${baseUrl(params)}/files/${id}/${purpose}` });
  app.get(`${baseRoute}/result`, async (request) => {
    const params = Params.parse(request.params);
    return projectResult(await readAttemptResult(pool, params.id, params.attemptId), links(params));
  });
  app.get(`${baseRoute}/files/:artifactId/:purpose`, async (request, reply) => {
    const params = Params.extend({ artifactId: z.uuid(), purpose: z.enum(['text', 'media']) }).parse(request.params);
    const saved = await readAttemptResult(pool, params.id, params.attemptId);
    const supplied = links(params);
    let allowed = false;
    await projectResult(saved, { ...supplied, artifact: (id, purpose) => { if (id === params.artifactId && purpose === params.purpose) allowed = true; return supplied.artifact(id, purpose); } });
    const file = saved.artifacts.find((file) => file.metadata.id === params.artifactId);
    if (!allowed || !file) throw new NotFound();
    if (params.purpose === 'text') return TextFile.parse({ text: decodeText(file.bytes) });
    return reply.type(file.metadata.mediaType).send(file.bytes);
  });
  app.post(`${baseRoute}/preview`, async (request, reply) => {
    const params = Params.parse(request.params);
    const saved = await readAttemptResult(pool, params.id, params.attemptId);
    try { return await previews.open(baseUrl(params), htmlBundle(saved)); }
    catch (error) { if (error instanceof PreviewUnavailable) return reply.code(503).send({ error: error.message }); throw error; }
  });
  app.post(`${baseRoute}/preview/:previewId/input`, async (request, reply) => {
    const params = Params.extend({ previewId: z.uuid() }).parse(request.params);
    const input = PreviewInput.parse(request.body);
    try { return await previews.input(baseUrl(params), params.previewId, input); }
    catch (error) { if (error instanceof PreviewUnavailable) return reply.code(503).send({ error: error.message }); throw error; }
  });
  app.delete(`${baseRoute}/preview/:previewId`, async (request, reply) => {
    const params = Params.extend({ previewId: z.uuid() }).parse(request.params);
    await previews.close(baseUrl(params), params.previewId);
    return reply.code(204).send();
  });
  return previews;
}
