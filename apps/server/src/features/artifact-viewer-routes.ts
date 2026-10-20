import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { ConfiguredAttemptId, ConfiguredRunId } from '../../../../packages/contracts/src/configured-runs.ts';
import { TextFile } from '../../../../packages/contracts/src/artifact-viewer.ts';
import { readAttemptResult } from './configured-runs.ts';
import { decodeText, projectResult, type ResultLinks } from './artifact-viewer.ts';
import { grantPreview, previewPolicy, PreviewToken, readPreviewFile } from './html-preview.ts';
import { NotFound } from '../errors.ts';

const Params = z.object({ id: ConfiguredRunId, attemptId: ConfiguredAttemptId });
const baseRoute = '/api/configured-runs/:id/attempts/:attemptId';
/** Serves granted HTML bundles by token alone, ignoring cookies; `origin` is the dashboard's canonical origin. */
export function registerPreviewFiles(app: FastifyInstance, pool: pg.Pool, origin: (request: FastifyRequest) => string) {
  app.get('/preview/:token/*', async (request, reply) => {
    const { token } = z.object({ token: PreviewToken }).parse(request.params);
    const path = (request.url.split('?')[0] ?? '').slice(`/preview/${token}/`.length);
    const file = await readPreviewFile(pool, token, path);
    return reply
      .header('Content-Security-Policy', previewPolicy(origin(request), token))
      .header('Access-Control-Allow-Origin', '*')
      .type(file.mediaType)
      .send(file.bytes);
  });
}

export function registerArtifactViewer(app: FastifyInstance, pool: pg.Pool) {
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
    return reply
      .header('Content-Disposition', 'inline; filename="result.bin"')
      .header('Content-Security-Policy', "sandbox; default-src 'none'")
      .type(file.metadata.mediaType)
      .send(file.bytes);
  });
  app.post(`${baseRoute}/preview`, async (request) => {
    const params = Params.parse(request.params);
    z.object({}).strict().parse(request.body);
    return grantPreview(pool, params.attemptId, await readAttemptResult(pool, params.id, params.attemptId));
  });
}
