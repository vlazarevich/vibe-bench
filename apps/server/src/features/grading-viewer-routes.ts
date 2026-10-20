import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { GradingCardHandle, GradingSessionId, GradingTaskHandle } from '../../../../packages/contracts/src/blind-grading.ts';
import { TextFile, SharedTaskInputs } from '../../../../packages/contracts/src/artifact-viewer.ts';
import { readGradingCard, readGradingTask } from './blind-grading.ts';
import { readAttemptResult } from './configured-runs.ts';
import { decodeText, projectResult, type ResultLinks, type SavedResult } from './artifact-viewer.ts';
import { grantPreview } from './html-preview.ts';
import { NotFound } from '../errors.ts';

const Params = z.object({ id: GradingSessionId, card: GradingCardHandle });
const route = '/api/blind-grading/:id/cards/:card';
const baseUrl = (params: z.infer<typeof Params>) => `/api/blind-grading/${params.id}/cards/${params.card}`;
function links(params: z.infer<typeof Params>, saved: SavedResult): ResultLinks {
  return { names: 'neutral', html: () => `${baseUrl(params)}/preview`, artifact: (id, purpose) => {
    const index = saved.outcome.artifacts.findIndex((artifact) => artifact.id === id);
    if (index < 0) throw new NotFound();
    return `${baseUrl(params)}/files/${index}/${purpose}`;
  } };
}
export function registerGradingViewer(app: FastifyInstance, pool: pg.Pool) {
  const authorize = (params: z.infer<typeof Params>, authority: string | undefined) => readGradingCard(pool, params.id, authority ?? '', params.card);
  async function savedResult(params: z.infer<typeof Params>, authority: string | undefined) {
    const card = await authorize(params, authority);
    return readAttemptResult(pool, card.runId, card.attemptId);
  }
  app.get('/api/blind-grading/:id/tasks/:task/inputs', async (request) => {
    const params = z.object({ id: GradingSessionId, task: GradingTaskHandle }).parse(request.params);
    const authority = request.cookies.vibe_grading_authority;
    const task = await readGradingTask(pool, params.id, authority ?? '', params.task);
    const cards = task.cards.filter((card) => card.kind === 'completed');
    let first: { saved: SavedResult; card: z.infer<typeof GradingCardHandle> } | undefined;
    for (const card of cards) {
      const saved = await savedResult({ id: params.id, card: card.handle }, authority);
      const inputs = saved.outcome.result.inputs ?? [];
      if (!inputs.length) return SharedTaskInputs.parse({ shared: false });
      if (!first) { first = { saved, card: card.handle }; continue; }
      const original = first.saved.outcome.result.inputs ?? [];
      if (original.length !== inputs.length || !inputs.every((input, index) => {
        const other = original[index];
        const file = saved.artifacts.find((a) => a.metadata.id === input.artifactId);
        const previous = first!.saved.artifacts.find((a) => a.metadata.id === other?.artifactId);
        return input.kind === other?.kind && file && previous && file.metadata.mediaType === previous.metadata.mediaType && file.bytes.equals(previous.bytes);
      })) return SharedTaskInputs.parse({ shared: false });
    }
    if (!first) return SharedTaskInputs.parse({ shared: false });
    const presentation = await projectResult(first.saved, links({ id: params.id, card: first.card }, first.saved));
    return SharedTaskInputs.parse({ shared: true, inputs: presentation.inputs });
  });
  app.get(`${route}/result`, async (request) => {
    const params = Params.parse(request.params), saved = await savedResult(params, request.cookies.vibe_grading_authority);
    return projectResult(saved, links(params, saved));
  });
  app.get(`${route}/files/:file/:purpose`, async (request, reply) => {
    const params = Params.extend({ file: z.string().regex(/^(0|[1-9][0-9]?)$/).transform(Number).pipe(z.number().max(31)), purpose: z.enum(['download', 'text', 'media']) }).parse(request.params);
    const saved = await savedResult(params, request.cookies.vibe_grading_authority);
    const metadata = saved.outcome.artifacts[params.file];
    if (!metadata || metadata.kind === 'diagnostic') throw new NotFound();
    const supplied = links(params, saved);
    let published = false;
    await projectResult(saved, { ...supplied, artifact: (id, purpose) => { if (id === metadata.id && purpose === params.purpose) published = true; return supplied.artifact(id, purpose); } });
    const file = saved.artifacts.find((file) => file.metadata.id === metadata.id);
    if (!published || !file) throw new NotFound();
    if (params.purpose === 'text') return TextFile.parse({ text: decodeText(file.bytes) });
    reply.header('Content-Disposition', `${params.purpose === 'download' ? 'attachment' : 'inline'}; filename="result.bin"`).header('Content-Security-Policy', "sandbox; default-src 'none'");
    return reply.type(params.purpose === 'download' ? 'application/octet-stream' : file.metadata.mediaType).send(file.bytes);
  });
  app.post(`${route}/preview`, async (request) => {
    const params = Params.parse(request.params);
    z.object({}).strict().parse(request.body);
    const card = await authorize(params, request.cookies.vibe_grading_authority);
    return grantPreview(pool, card.attemptId, await readAttemptResult(pool, card.runId, card.attemptId));
  });
}
